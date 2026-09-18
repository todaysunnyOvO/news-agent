import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgentRunRepository,
  ArticleRepository,
  BriefRepository,
  createDatabase,
  migrateDatabase,
  UserRepository,
  type DatabaseContext,
} from "@news-agent/db";
import type {
  BriefFeedbackSummary,
  BriefItemFeedback,
  SavedItem,
  TrackedTopic,
} from "@news-agent/shared";

import { createApp } from "./app.js";

describe("R2 feedback API", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => database.close());

  function seedBrief() {
    const user = new UserRepository(database.db).create({ displayName: "Feedback API User" });
    const runId = new AgentRunRepository(database.db).create(user.id);
    new ArticleRepository(database.db).upsertMany([
      {
        articleId: "api-r2-article",
        provider: "mock",
        sourceId: "source",
        sourceName: "Source",
        title: "R2 news",
        canonicalUrl: "https://example.com/api-r2",
        publishedAt: "2026-09-18T00:00:00.000Z",
        retrievedAt: "2026-09-18T01:00:00.000Z",
        language: "en",
      },
    ]);
    const brief = new BriefRepository(database.db).save(
      {
        userId: user.id,
        runId,
        title: "R2 API Brief",
        overview: "Overview",
        items: [
          {
            headline: "R2 news",
            summary: "Summary",
            whyItMatters: "Why",
            topic: "Agents",
            sourceArticleIds: ["api-r2-article"],
          },
        ],
      },
      { localDate: "2026-09-18", markdownPath: "briefs/api-r2.md" },
    );
    const item = new BriefRepository(database.db).findDetailById(brief.id)!.items[0]!;
    return { user, brief, item };
  }

  it("supports the complete feedback, save, and tracking lifecycle", async () => {
    const { user, brief, item } = seedBrief();
    const app = await createApp({ db: database.db });

    const overall = await app.inject({
      method: "PUT",
      url: `/api/briefs/${brief.id}/feedback`,
      payload: {
        userId: user.id,
        usefulness: "useful",
        lengthRating: "about_right",
        missedImportantNews: false,
        comment: "Keep this format",
      },
    });
    expect(overall.statusCode).toBe(200);

    const itemFeedback = await app.inject({
      method: "PUT",
      url: `/api/brief-items/${item.id}/feedback/useful`,
      payload: { userId: user.id },
    });
    expect(itemFeedback.statusCode).toBe(200);
    expect(itemFeedback.json<BriefItemFeedback>().active).toBe(true);

    const summary = await app.inject({
      method: "GET",
      url: `/api/briefs/${brief.id}/feedback?userId=${user.id}`,
    });
    expect(summary.json<BriefFeedbackSummary>()).toMatchObject({
      briefFeedback: { usefulness: "useful", comment: "Keep this format" },
      itemFeedback: [{ feedbackType: "useful", active: true }],
    });

    await app.inject({
      method: "DELETE",
      url: `/api/brief-items/${item.id}/feedback/useful`,
      payload: { userId: user.id },
    });
    const afterRevoke = await app.inject({
      method: "GET",
      url: `/api/briefs/${brief.id}/feedback?userId=${user.id}`,
    });
    expect(afterRevoke.json<BriefFeedbackSummary>().itemFeedback).toEqual([]);

    await app.inject({
      method: "PUT",
      url: `/api/brief-items/${item.id}/saved`,
      payload: { userId: user.id },
    });
    const saved = await app.inject({
      method: "GET",
      url: `/api/users/${user.id}/saved-items`,
    });
    expect(saved.json<SavedItem[]>()).toHaveLength(1);

    const tracking = await app.inject({
      method: "POST",
      url: `/api/brief-items/${item.id}/tracking`,
      payload: { userId: user.id },
    });
    const tracked = tracking.json<TrackedTopic>();
    expect(tracked.status).toBe("active");
    const paused = await app.inject({
      method: "PATCH",
      url: `/api/tracked-topics/${tracked.id}`,
      payload: { userId: user.id, status: "paused" },
    });
    expect(paused.json<TrackedTopic>().status).toBe("paused");

    await app.close();
  });

  it("validates feedback types and enforces item ownership", async () => {
    const { item } = seedBrief();
    const other = new UserRepository(database.db).create({ displayName: "Other API User" });
    const app = await createApp({ db: database.db });

    const invalid = await app.inject({
      method: "PUT",
      url: `/api/brief-items/${item.id}/feedback/not-a-type`,
      payload: { userId: other.id },
    });
    expect(invalid.statusCode).toBe(400);

    const forbiddenByOwnership = await app.inject({
      method: "PUT",
      url: `/api/brief-items/${item.id}/feedback/useful`,
      payload: { userId: other.id },
    });
    expect(forbiddenByOwnership.statusCode).toBe(404);
    await app.close();
  });
});
