import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentRunRepository, BriefRepository, createDatabase, DeliveryRepository, migrateDatabase, SubscriptionRepository, UserRepository, type DatabaseContext } from "@news-agent/db";
import type { BriefDetail, SavedBrief, User } from "@news-agent/shared";

import { createApp } from "./app.js";
import { createDemoAgentController } from "./demo-runtime.js";
import { WebhookDeliveryService } from "./delivery.js";
import { InMemoryRunEventStore } from "./run-event-store.js";
import { isSubscriptionDue, NewsScheduler } from "./scheduler.js";
import type { AgentRunController, AppRepositories } from "./types.js";

const temporaryDirectories: string[] = [];

describe("Phase 5 end-to-end experience", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(async () => {
    database.close();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("creates a run, replays SSE events, and serves brief history, detail, and Markdown", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "news-agent-e2e-"));
    temporaryDirectories.push(dataRoot);
    const controller = await createDemoAgentController(database.db, dataRoot);
    const app = await createApp({ db: database.db, dataRoot, agentController: controller });
    const created = await app.inject({ method: "POST", url: "/api/users", payload: { displayName: "E2E User" } });
    const user = created.json<User>();
    await app.inject({
      method: "PUT", url: `/api/users/${user.id}/subscription`,
      payload: { topics: ["AI Agent"], keywords: ["agent"], excludedKeywords: [], languages: ["en"], sourceIds: [], maxItems: 5, scheduleCron: "0 8 * * *", timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true },
    });

    const started = await app.inject({ method: "POST", url: `/api/users/${user.id}/runs`, payload: {} });
    expect(started.statusCode).toBe(202);
    const runId = started.json<{ runId: string }>().runId;
    const runs = new AgentRunRepository(database.db);
    for (let attempt = 0; attempt < 100 && !["succeeded", "failed", "cancelled"].includes(runs.findById(runId)?.status ?? ""); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(runs.findById(runId)?.status).toBe("succeeded");

    const stream = await app.inject({ method: "GET", url: `/api/runs/${runId}/events` });
    expect(stream.statusCode).toBe(200);
    expect(stream.body).toContain("event: tool_started");
    expect(stream.body).toContain("event: run_finished");
    expect(stream.body).not.toContain("content\":\"");

    const historyResponse = await app.inject({ method: "GET", url: `/api/users/${user.id}/briefs` });
    const history = historyResponse.json<SavedBrief[]>();
    expect(history).toHaveLength(1);
    const detailResponse = await app.inject({ method: "GET", url: `/api/briefs/${history[0]?.id ?? ""}` });
    const detail = detailResponse.json<BriefDetail>();
    expect(detail.items[0]?.sources[0]?.canonicalUrl).toBe("https://example.com/news/pi-agent-mvp");
    const markdown = await app.inject({ method: "GET", url: `/api/briefs/${detail.id}/markdown` });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.body).toContain("每日 AI 新闻简报");
    const evaluation = await app.inject({ method: "GET", url: `/api/runs/${runId}/evaluation` });
    expect(evaluation.json<{ quality: { score: number }; performance: { durationMs: number } }>().quality.score).toBeGreaterThanOrEqual(70);
    expect(evaluation.json<{ quality: { score: number }; performance: { durationMs: number } }>().performance.durationMs).toBeGreaterThan(0);
    await app.close();
  });

  it("calculates timezone schedules and prevents duplicate daily runs", async () => {
    const users = new UserRepository(database.db);
    const subscriptions = new SubscriptionRepository(database.db);
    const runs = new AgentRunRepository(database.db);
    const user = users.create({ displayName: "Scheduled User" });
    const subscription = subscriptions.upsert(user.id, { topics: ["AI"], keywords: [], excludedKeywords: [], languages: ["en"], sourceIds: [], maxItems: 3, scheduleCron: "30 8 * * *", timezone: "UTC", deliveryChannel: "web", enabled: true });
    const now = new Date("2026-09-18T08:30:00.000Z");
    expect(isSubscriptionDue(subscription, now)).toEqual({ due: true, localDate: "2026-09-18" });

    let starts = 0;
    const controller: AgentRunController = {
      start(input) {
        starts += 1;
        const runId = runs.create(input.userId, "scheduler-test", "scheduled", input.idempotencyKey);
        runs.finish(runId, "succeeded", 0);
        return { runId, completion: Promise.resolve({ runId, status: "succeeded", finalText: "", toolCallCount: 0, turnCount: 0 }) };
      },
      cancel: async () => false,
    };
    const repositories: AppRepositories = { users, subscriptions, runs, briefs: new BriefRepository(database.db) };
    const scheduler = new NewsScheduler(repositories, controller, new InMemoryRunEventStore());
    await scheduler.tick(now);
    await scheduler.tick(now);
    expect(starts).toBe(1);
  });

  it("retries webhook delivery and does not deliver the same run twice", async () => {
    const user = new UserRepository(database.db).create({ displayName: "Delivery User" });
    const runs = new AgentRunRepository(database.db);
    const runId = runs.create(user.id);
    runs.finish(runId, "succeeded", 1);
    let calls = 0;
    const delivery = new WebhookDeliveryService(database.db, "https://hooks.example/news", async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 503 : 204 });
    });
    const result = { runId, status: "succeeded" as const, briefId: "brief-1", finalText: "", toolCallCount: 1, turnCount: 1 };
    await delivery.deliver(result);
    await delivery.deliver(result);
    expect(calls).toBe(2);
    expect(new DeliveryRepository(database.db).find(runId, "webhook")).toMatchObject({ status: "delivered", attempts: 2 });
  });
});
