import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DatabaseContext } from "./database.js";
import { createDatabase, migrateDatabase } from "./database.js";
import { AgentRunRepository } from "./repositories/agent-run-repository.js";
import { ArticleRepository } from "./repositories/article-repository.js";
import { BriefRepository } from "./repositories/brief-repository.js";
import { FeedbackRepository } from "./repositories/feedback-repository.js";
import { LibraryRepository } from "./repositories/library-repository.js";
import { UserRepository } from "./repositories/user-repository.js";

describe("R2 feedback and personal library repositories", () => {
  let database: DatabaseContext;

  beforeEach(() => {
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
  });

  afterEach(() => database.close());

  function seedBrief() {
    const user = new UserRepository(database.db).create({ displayName: "R2 User" });
    const runId = new AgentRunRepository(database.db).create(user.id);
    new ArticleRepository(database.db).upsertMany([
      {
        articleId: "article-r2",
        provider: "mock",
        sourceId: "official",
        sourceName: "Official",
        title: "Agent update",
        canonicalUrl: "https://example.com/r2-agent",
        publishedAt: "2026-09-18T00:00:00.000Z",
        retrievedAt: "2026-09-18T01:00:00.000Z",
        language: "en",
      },
    ]);
    const saved = new BriefRepository(database.db).save(
      {
        userId: user.id,
        runId,
        title: "R2 Brief",
        overview: "Overview",
        items: [
          {
            headline: "Agent update",
            summary: "A useful update",
            whyItMatters: "It improves daily work",
            topic: "AI Agent",
            sourceArticleIds: ["article-r2"],
          },
        ],
      },
      { localDate: "2026-09-18", markdownPath: "briefs/r2.md" },
    );
    const detail = new BriefRepository(database.db).findDetailById(saved.id)!;
    return { user, brief: detail, item: detail.items[0]! };
  }

  it("upserts overall feedback and preserves unspecified fields", () => {
    const { user, brief } = seedBrief();
    const feedback = new FeedbackRepository(database.db);
    feedback.upsertBrief(user.id, brief.id, {
      usefulness: "useful",
      lengthRating: "about_right",
      comment: "Good selection",
    });
    const updated = feedback.upsertBrief(user.id, brief.id, { missedImportantNews: true });

    expect(updated).toMatchObject({
      usefulness: "useful",
      lengthRating: "about_right",
      missedImportantNews: true,
      comment: "Good selection",
    });
  });

  it("activates and revokes item feedback idempotently", () => {
    const { user, brief, item } = seedBrief();
    const feedback = new FeedbackRepository(database.db);
    const first = feedback.setItemFeedback(user.id, item.id, "already_known", true);
    const repeated = feedback.setItemFeedback(user.id, item.id, "already_known", true);
    feedback.setItemFeedback(user.id, item.id, "already_known", false);

    expect(repeated?.id).toBe(first?.id);
    expect(feedback.getSummary(user.id, brief.id)?.itemFeedback).toEqual([]);
  });

  it("saves an item and creates one idempotent tracking topic", () => {
    const { user, item } = seedBrief();
    const library = new LibraryRepository(database.db);
    const saved = library.saveItem(user.id, item.id);
    const repeated = library.saveItem(user.id, item.id);
    const tracked = library.trackItem(user.id, item.id);
    const repeatedTracking = library.trackItem(user.id, item.id);

    expect(repeated?.id).toBe(saved?.id);
    expect(library.listSavedItems(user.id)).toHaveLength(1);
    expect(repeatedTracking?.id).toBe(tracked?.id);
    expect(tracked).toMatchObject({
      label: "Agent update",
      status: "active",
      query: { topic: "AI Agent", sourceArticleIds: ["article-r2"] },
    });
    expect(library.updateTrackedTopic(user.id, tracked!.id, { status: "paused" })?.status).toBe(
      "paused",
    );
  });

  it("rejects resources owned by another user", () => {
    const { brief, item } = seedBrief();
    const other = new UserRepository(database.db).create({ displayName: "Other" });
    expect(new FeedbackRepository(database.db).upsertBrief(other.id, brief.id, { usefulness: "useful" })).toBeUndefined();
    expect(new FeedbackRepository(database.db).setItemFeedback(other.id, item.id, "useful", true)).toBeUndefined();
    expect(new LibraryRepository(database.db).saveItem(other.id, item.id)).toBeUndefined();
    expect(new LibraryRepository(database.db).trackItem(other.id, item.id)).toBeUndefined();
  });
});
