import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgentRunRepository,
  ArticleRepository,
  BriefRepository,
  createDatabase,
  DeliveryRepository,
  FeedbackRepository,
  LibraryRepository,
  migrateDatabase,
  SubscriptionRepository,
  UserRepository,
  type DatabaseContext,
} from "@news-agent/db";
import type { BriefDetail, MetricsSnapshot, VersionComparisonReport } from "@news-agent/shared";

import { createApp } from "./app.js";

describe("R2 quality operations", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => database.close());

  it("reads R1 briefs and R2 structured items through the same API", async () => {
    const users = new UserRepository(database.db);
    const runs = new AgentRunRepository(database.db);
    const articles = new ArticleRepository(database.db);
    const briefs = new BriefRepository(database.db);
    const user = users.create({ displayName: "Compatibility Reader" });
    const firstRun = runs.create(user.id);
    const secondRun = runs.create(user.id);
    articles.upsertMany([{
      articleId: "source", provider: "fixture", sourceId: "official", sourceName: "Official",
      title: "AI Agent release", canonicalUrl: "https://example.com/source",
      publishedAt: "2026-09-18T07:00:00.000Z", retrievedAt: "2026-09-18T08:00:00.000Z", language: "en",
    }]);
    const r1 = briefs.save({
      userId: user.id, runId: firstRun, title: "R1", overview: "Legacy brief",
      items: [{ headline: "Legacy", summary: "Summary", whyItMatters: "Reason", topic: "AI", sourceArticleIds: ["source"] }],
    }, { localDate: "2026-09-18", markdownPath: "briefs/r1.md" });
    const r2 = briefs.save({
      userId: user.id, runId: secondRun, title: "R2", overview: "Structured brief",
      items: [{
        headline: "Structured", summary: "Summary", whyItMatters: "Reason", topic: "AI", sourceArticleIds: ["source"],
        section: "top", novelty: "new", recommendationReason: "Matches accepted AI preference", evidenceStatus: "official",
      }],
    }, { localDate: "2026-09-18", markdownPath: "briefs/r2.md" });
    const app = await createApp({ db: database.db });
    const legacy = (await app.inject({ method: "GET", url: `/api/briefs/${r1.id}` })).json<BriefDetail>();
    const structured = (await app.inject({ method: "GET", url: `/api/briefs/${r2.id}` })).json<BriefDetail>();
    expect(legacy.items[0]).not.toHaveProperty("section");
    expect(structured.items[0]).toMatchObject({ section: "top", novelty: "new", evidenceStatus: "official" });
    await app.close();
  });

  it("aggregates quality, reliability, cost, and fixed benchmark reports", async () => {
    const users = new UserRepository(database.db);
    const subscriptions = new SubscriptionRepository(database.db);
    const runs = new AgentRunRepository(database.db);
    const articles = new ArticleRepository(database.db);
    const briefs = new BriefRepository(database.db);
    const feedback = new FeedbackRepository(database.db);
    const library = new LibraryRepository(database.db);
    const deliveries = new DeliveryRepository(database.db);
    const user = users.create({ displayName: "Metrics Reader" });
    subscriptions.upsert(user.id, {
      topics: ["AI"], keywords: [], excludedKeywords: [], languages: ["en"], sourceIds: [], maxItems: 5,
      scheduleCron: "0 8 * * *", timezone: "UTC", deliveryChannel: "email", enabled: true,
    });
    const runId = runs.create(user.id, "fixture-model", "scheduled");
    runs.markRunning(runId);
    articles.upsertMany([{
      articleId: "metric-source", provider: "fixture", sourceId: "official", sourceName: "Official",
      title: "AI release", canonicalUrl: "https://example.com/metric-source",
      publishedAt: "2026-09-18T07:00:00.000Z", retrievedAt: "2026-09-18T08:00:00.000Z", language: "en",
    }]);
    const brief = briefs.save({
      userId: user.id, runId, title: "Metrics", overview: "Metrics brief",
      items: [{ headline: "AI release", summary: "Summary", whyItMatters: "Reason", topic: "AI", sourceArticleIds: ["metric-source"] }],
    }, { localDate: "2026-09-18", markdownPath: "briefs/metrics.md" });
    runs.finish(runId, "succeeded", 4, undefined, { turnCount: 2, durationMs: 1000, inputTokens: 100, outputTokens: 50, costUsd: 0.02 });
    const detail = briefs.findDetailById(brief.id)!;
    feedback.upsertBrief(user.id, brief.id, { usefulness: "useful" });
    feedback.setItemFeedback(user.id, detail.items[0]!.id, "useful", true);
    library.saveItem(user.id, detail.items[0]!.id);
    library.trackItem(user.id, detail.items[0]!.id);
    const delivery = deliveries.createJob({
      briefId: brief.id, runId, userId: user.id, channel: "email", destinationHash: "redacted", idempotencyKey: `${runId}:email`,
    });
    deliveries.recordAttempt(delivery.id, { success: true, durationMs: 20, providerMessageId: "message" });

    const app = await createApp({ db: database.db });
    const metrics = (await app.inject({ method: "GET", url: `/api/users/${user.id}/metrics` })).json<MetricsSnapshot>();
    expect(metrics.quality).toMatchObject({ briefCount: 1, itemCount: 1, briefUsefulRate: 1, itemUsefulRate: 1, savedRate: 1, trackedRate: 1 });
    expect(metrics.reliability).toMatchObject({ scheduledRunCount: 1, generationSuccessRate: 1, deliverySuccessRate: 1, firstAttemptSuccessRate: 1, duplicateDeliveryCount: 0 });
    expect(metrics.performance).toMatchObject({ averageDurationMs: 1000, inputTokens: 100, outputTokens: 50, costUsd: 0.02, averageCostPerSelectedItemUsd: 0.02 });
    expect(JSON.stringify(metrics)).not.toMatch(/destinationHash|providerMessageId|metric-source|RESEND_API_KEY/);

    const comparison = (await app.inject({ method: "GET", url: `/api/users/${user.id}/version-comparison` })).json<VersionComparisonReport>();
    expect(comparison.versions).toEqual({ prompt: "r2.1", ranking: "r2-personalization-v1", report: "r2-metrics-v1" });
    expect(comparison.offlineBenchmark).toMatchObject({ scenarioCount: 3, passedScenarios: 3, score: 1 });
    await app.close();
  });
});
