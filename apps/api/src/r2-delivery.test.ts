import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgentRunRepository,
  ArticleRepository,
  BriefRepository,
  createDatabase,
  DeliveryRepository,
  migrateDatabase,
  SubscriptionRepository,
  UserRepository,
  type DatabaseContext,
} from "@news-agent/db";
import type { BriefItemFeedbackType, Subscription } from "@news-agent/shared";

import {
  DeliveryAdapterError,
  DeliveryService,
  ResendEmailAdapter,
  type DeliveryAdapter,
  type DeliveryContent,
} from "./delivery.js";
import { createApp } from "./app.js";
import { isSubscriptionDue } from "./scheduler.js";
import { FeedbackActionSigner } from "./signed-actions.js";

describe("R2 daily delivery", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => database.close());

  function seedBrief(channel: "email" | "webhook" = "email") {
    const user = new UserRepository(database.db).create({ displayName: "Daily Reader" });
    new SubscriptionRepository(database.db).upsert(user.id, {
      topics: ["AI"], keywords: [], excludedKeywords: [], languages: ["zh-CN"], sourceIds: [],
      maxItems: 5, scheduleCron: "0 8 * * *", timezone: "Asia/Shanghai", deliveryChannel: channel, enabled: true,
    });
    const runId = new AgentRunRepository(database.db).create(user.id);
    new ArticleRepository(database.db).upsertMany([{
      articleId: "r2-mail-article", provider: "mock", sourceId: "official", sourceName: "Official",
      title: "Daily update", canonicalUrl: "https://example.com/daily-update",
      publishedAt: "2026-09-18T00:00:00.000Z", retrievedAt: "2026-09-18T01:00:00.000Z", language: "en",
    }]);
    const brief = new BriefRepository(database.db).save({
      userId: user.id, runId, title: "每日简报", overview: "今天的重要进展",
      items: [{ headline: "Daily update", summary: "Summary", whyItMatters: "Why", topic: "AI", sourceArticleIds: ["r2-mail-article"] }],
    }, { localDate: "2026-09-18", markdownPath: "briefs/r2-mail.md" });
    return { user, brief, item: new BriefRepository(database.db).findDetailById(brief.id)!.items[0]! };
  }

  it("sends Resend requests with the configured sender and a stable idempotency key", async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const adapter = new ResendEmailAdapter(
      "secret-key",
      "News Agent <brief@mail.dailynewsagent.site>",
      "reader@163.com",
      async (input, init) => {
        captured = { url: String(input), ...(init ? { init } : {}) };
        return new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    );
    const result = await adapter.send({ subject: "Brief", html: "<p>Brief</p>", text: "Brief", webhookBody: {} }, "brief:1:email");

    expect(result.providerMessageId).toBe("resend-message-1");
    expect(captured?.url).toBe("https://api.resend.com/emails");
    expect(new Headers(captured?.init?.headers).get("authorization")).toBe("Bearer secret-key");
    expect(new Headers(captured?.init?.headers).get("idempotency-key")).toBe("brief:1:email");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      from: "News Agent <brief@mail.dailynewsagent.site>",
      to: ["reader@163.com"],
    });
  });

  it("persists a transient failure, retries it, and never delivers a succeeded brief twice", async () => {
    const { brief } = seedBrief();
    let attempts = 0;
    let now = new Date("2026-09-18T00:00:00.000Z");
    const adapter: DeliveryAdapter = {
      channel: "email",
      destination: "reader@163.com",
      async send(_content: DeliveryContent) {
        attempts += 1;
        if (attempts === 1) throw new DeliveryAdapterError("temporary", "temporary", true);
        return { providerMessageId: "email-2" };
      },
    };
    const signer = new FeedbackActionSigner("a-secure-test-signing-secret-123456789");
    const service = new DeliveryService(database.db, [adapter], "http://localhost:5173", signer, () => now);

    const first = await service.enqueueBrief(brief.id);
    expect(first).toMatchObject({ status: "pending", attemptCount: 1 });
    now = new Date("2026-09-18T00:01:01.000Z");
    await service.processDue(now);
    await service.enqueueBrief(brief.id);

    const job = new DeliveryRepository(database.db).findById(first!.id)!;
    expect(job).toMatchObject({ status: "succeeded", attemptCount: 2 });
    expect(new DeliveryRepository(database.db).listAttempts(job.id)).toHaveLength(2);
    expect(attempts).toBe(2);
  });

  it("signs bounded feedback actions and rejects expiry or tampering", () => {
    const signer = new FeedbackActionSigner("a-secure-test-signing-secret-123456789");
    const payload = {
      userId: "user", briefId: "brief", itemId: "item",
      type: "useful" as BriefItemFeedbackType, expiresAt: 2_000,
    };
    const token = signer.sign(payload);
    expect(signer.verify(token, 1_000)).toEqual(payload);
    expect(signer.verify(`${token}x`, 1_000)).toBeUndefined();
    expect(signer.verify(token, 2_001)).toBeUndefined();
  });

  it("supports manual delivery status and signed feedback through the API", async () => {
    const { user, brief, item } = seedBrief();
    const adapter: DeliveryAdapter = {
      channel: "email", destination: "reader@163.com", send: async () => ({ providerMessageId: "email-api" }),
    };
    const signer = new FeedbackActionSigner("a-secure-test-signing-secret-123456789");
    const service = new DeliveryService(database.db, [adapter], "http://localhost:5173", signer);
    const app = await createApp({ db: database.db, deliveryService: service, feedbackActionSigner: signer });

    const delivered = await app.inject({ method: "POST", url: `/api/briefs/${brief.id}/deliver`, payload: { userId: user.id } });
    expect(delivered.statusCode).toBe(202);
    const listed = await app.inject({ method: "GET", url: `/api/briefs/${brief.id}/deliveries` });
    expect(listed.json<Array<{ status: string }>>()).toMatchObject([{ status: "succeeded" }]);

    const token = signer.sign({ userId: user.id, briefId: brief.id, itemId: item.id, type: "useful", expiresAt: Date.now() + 60_000 });
    const feedback = await app.inject({ method: "GET", url: `/api/email-actions/feedback?token=${encodeURIComponent(token)}` });
    expect(feedback.statusCode).toBe(200);
    expect(feedback.body).toContain("反馈已记录");
    await app.close();
  });

  it("supports weekday schedules, pauses, skipped dates, and a four-hour compensation window", () => {
    const base: Subscription = {
      id: "subscription", userId: "user", topics: [], keywords: [], excludedKeywords: [], languages: ["zh-CN"], sourceIds: [],
      maxItems: 5, scheduleCron: "0 8 * * 1-5", timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true,
      pausedUntil: null, skipDates: [], createdAt: "", updatedAt: "",
    };
    expect(isSubscriptionDue(base, new Date("2026-09-18T00:00:00.000Z")).due).toBe(true);
    expect(isSubscriptionDue(base, new Date("2026-09-18T03:59:00.000Z")).due).toBe(true);
    expect(isSubscriptionDue(base, new Date("2026-09-18T04:01:00.000Z")).due).toBe(false);
    expect(isSubscriptionDue({ ...base, pausedUntil: "2026-09-18" }, new Date("2026-09-18T00:00:00.000Z")).due).toBe(false);
    expect(isSubscriptionDue({ ...base, skipDates: ["2026-09-18"] }, new Date("2026-09-18T00:00:00.000Z")).due).toBe(false);
    expect(isSubscriptionDue(base, new Date("2026-09-19T00:00:00.000Z")).due).toBe(false);
  });
});
