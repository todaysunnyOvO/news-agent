import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type {
  SavedItem,
  TrackedTopic,
  TrackedTopicQuery,
  TrackedTopicStatus,
} from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import {
  briefItemSources,
  briefItems,
  briefs,
  savedItems,
  trackedTopics,
} from "../schema.js";

export class LibraryRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public saveItem(userId: string, briefItemId: string): SavedItem | undefined {
    const item = this.findOwnedItem(userId, briefItemId);
    if (!item) return undefined;
    const existing = this.db
      .select()
      .from(savedItems)
      .where(and(eq(savedItems.userId, userId), eq(savedItems.briefItemId, briefItemId)))
      .get();
    if (!existing) {
      this.db
        .insert(savedItems)
        .values({ id: randomUUID(), userId, briefItemId, createdAt: new Date().toISOString() })
        .run();
    }
    return this.listSavedItems(userId).find((saved) => saved.briefItemId === briefItemId);
  }

  public removeSavedItem(userId: string, briefItemId: string): boolean {
    const result = this.db
      .delete(savedItems)
      .where(and(eq(savedItems.userId, userId), eq(savedItems.briefItemId, briefItemId)))
      .run();
    return result.changes > 0;
  }

  public listSavedItems(userId: string): SavedItem[] {
    return this.db
      .select({ saved: savedItems, item: briefItems, brief: briefs })
      .from(savedItems)
      .innerJoin(briefItems, eq(savedItems.briefItemId, briefItems.id))
      .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
      .where(eq(savedItems.userId, userId))
      .orderBy(desc(savedItems.createdAt))
      .all()
      .map(({ saved, item, brief }) => ({
        id: saved.id,
        userId: saved.userId,
        briefItemId: saved.briefItemId,
        briefId: brief.id,
        headline: item.headline,
        summary: item.summary,
        topic: item.topic,
        savedAt: saved.createdAt,
      }));
  }

  public trackItem(userId: string, briefItemId: string, label?: string): TrackedTopic | undefined {
    const item = this.findOwnedItem(userId, briefItemId);
    if (!item) return undefined;
    const existing = this.db
      .select()
      .from(trackedTopics)
      .where(
        and(eq(trackedTopics.userId, userId), eq(trackedTopics.sourceBriefItemId, briefItemId)),
      )
      .get();
    if (existing) return this.mapTrackedTopic(existing);
    const sourceArticleIds = this.db
      .select({ articleId: briefItemSources.articleId })
      .from(briefItemSources)
      .where(eq(briefItemSources.briefItemId, briefItemId))
      .all()
      .map(({ articleId }) => articleId);
    const query: TrackedTopicQuery = {
      headline: item.headline,
      topic: item.topic,
      sourceArticleIds,
    };
    const now = new Date().toISOString();
    const row = {
      id: randomUUID(),
      userId,
      label: label?.trim() || item.headline,
      queryJson: JSON.stringify(query),
      status: "active" as const,
      sourceBriefItemId: briefItemId,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(trackedTopics).values(row).run();
    return this.mapTrackedTopic(row);
  }

  public listTrackedTopics(userId: string): TrackedTopic[] {
    return this.db
      .select()
      .from(trackedTopics)
      .where(eq(trackedTopics.userId, userId))
      .orderBy(desc(trackedTopics.updatedAt))
      .all()
      .map((row) => this.mapTrackedTopic(row));
  }

  public updateTrackedTopic(
    userId: string,
    id: string,
    input: { label?: string; status?: TrackedTopicStatus },
  ): TrackedTopic | undefined {
    const existing = this.db
      .select()
      .from(trackedTopics)
      .where(and(eq(trackedTopics.id, id), eq(trackedTopics.userId, userId)))
      .get();
    if (!existing) return undefined;
    this.db
      .update(trackedTopics)
      .set({
        label: input.label?.trim() || existing.label,
        status: input.status ?? existing.status,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(trackedTopics.id, id))
      .run();
    return this.mapTrackedTopic(
      this.db.select().from(trackedTopics).where(eq(trackedTopics.id, id)).get()!,
    );
  }

  private findOwnedItem(userId: string, briefItemId: string) {
    return this.db
      .select({
        id: briefItems.id,
        headline: briefItems.headline,
        summary: briefItems.summary,
        topic: briefItems.topic,
      })
      .from(briefItems)
      .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
      .where(and(eq(briefItems.id, briefItemId), eq(briefs.userId, userId)))
      .get();
  }

  private mapTrackedTopic(row: typeof trackedTopics.$inferSelect): TrackedTopic {
    const { queryJson, ...fields } = row;
    return {
      ...fields,
      query: JSON.parse(queryJson) as TrackedTopicQuery,
      status: row.status as TrackedTopicStatus,
    };
  }
}
