import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type {
  BriefFeedback,
  BriefFeedbackSummary,
  BriefItemFeedback,
  BriefItemFeedbackType,
  UpsertBriefFeedbackInput,
} from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import {
  articles,
  briefFeedback,
  briefItemFeedback,
  briefItemSources,
  briefItems,
  briefs,
} from "../schema.js";

export interface FeedbackContextSignal {
  id: string;
  feedbackType: BriefItemFeedbackType;
  topic: string;
  headline: string;
  sourceNames: string[];
  occurredAt: string;
}

export class FeedbackRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public getSummary(userId: string, briefId: string): BriefFeedbackSummary | undefined {
    if (!this.userOwnsBrief(userId, briefId)) return undefined;
    const overall = this.db
      .select()
      .from(briefFeedback)
      .where(and(eq(briefFeedback.userId, userId), eq(briefFeedback.briefId, briefId)))
      .get();
    const itemRows = this.db
      .select({ feedback: briefItemFeedback })
      .from(briefItemFeedback)
      .innerJoin(briefItems, eq(briefItemFeedback.briefItemId, briefItems.id))
      .where(
        and(
          eq(briefItemFeedback.userId, userId),
          eq(briefItems.briefId, briefId),
          eq(briefItemFeedback.active, true),
        ),
      )
      .all();
    return {
      briefFeedback: overall ? this.mapBriefFeedback(overall) : null,
      itemFeedback: itemRows.map(({ feedback }) => this.mapItemFeedback(feedback)),
    };
  }

  public upsertBrief(
    userId: string,
    briefId: string,
    input: UpsertBriefFeedbackInput,
  ): BriefFeedback | undefined {
    if (!this.userOwnsBrief(userId, briefId)) return undefined;
    const existing = this.db
      .select()
      .from(briefFeedback)
      .where(and(eq(briefFeedback.userId, userId), eq(briefFeedback.briefId, briefId)))
      .get();
    const now = new Date().toISOString();
    const values = {
      id: existing?.id ?? randomUUID(),
      userId,
      briefId,
      usefulness: input.usefulness === undefined ? (existing?.usefulness ?? null) : input.usefulness,
      lengthRating:
        input.lengthRating === undefined ? (existing?.lengthRating ?? null) : input.lengthRating,
      missedImportantNews: input.missedImportantNews ?? existing?.missedImportantNews ?? false,
      comment:
        input.comment === undefined
          ? (existing?.comment ?? null)
          : input.comment?.trim() || null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .insert(briefFeedback)
      .values(values)
      .onConflictDoUpdate({
        target: [briefFeedback.userId, briefFeedback.briefId],
        set: {
          usefulness: values.usefulness,
          lengthRating: values.lengthRating,
          missedImportantNews: values.missedImportantNews,
          comment: values.comment,
          updatedAt: values.updatedAt,
        },
      })
      .run();
    return this.mapBriefFeedback(
      this.db
        .select()
        .from(briefFeedback)
        .where(and(eq(briefFeedback.userId, userId), eq(briefFeedback.briefId, briefId)))
        .get()!,
    );
  }

  public setItemFeedback(
    userId: string,
    briefItemId: string,
    feedbackType: BriefItemFeedbackType,
    active: boolean,
  ): BriefItemFeedback | undefined {
    if (!this.userOwnsItem(userId, briefItemId)) return undefined;
    const existing = this.db
      .select()
      .from(briefItemFeedback)
      .where(
        and(
          eq(briefItemFeedback.userId, userId),
          eq(briefItemFeedback.briefItemId, briefItemId),
          eq(briefItemFeedback.feedbackType, feedbackType),
        ),
      )
      .get();
    const now = new Date().toISOString();
    const values = {
      id: existing?.id ?? randomUUID(),
      userId,
      briefItemId,
      feedbackType,
      active,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db
      .insert(briefItemFeedback)
      .values(values)
      .onConflictDoUpdate({
        target: [
          briefItemFeedback.userId,
          briefItemFeedback.briefItemId,
          briefItemFeedback.feedbackType,
        ],
        set: { active, updatedAt: now },
      })
      .run();
    return this.mapItemFeedback(
      this.db
        .select()
        .from(briefItemFeedback)
        .where(eq(briefItemFeedback.id, values.id))
        .get()!,
    );
  }

  public listActiveSignals(userId: string): FeedbackContextSignal[] {
    const rows = this.db
      .select({ feedback: briefItemFeedback, item: briefItems })
      .from(briefItemFeedback)
      .innerJoin(briefItems, eq(briefItemFeedback.briefItemId, briefItems.id))
      .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
      .where(and(eq(briefItemFeedback.userId, userId), eq(briefItemFeedback.active, true), eq(briefs.userId, userId)))
      .all();
    return rows.map(({ feedback, item }) => {
      const sourceNames = this.db
        .select({ sourceName: articles.sourceName })
        .from(briefItemSources)
        .innerJoin(articles, eq(briefItemSources.articleId, articles.id))
        .where(eq(briefItemSources.briefItemId, item.id))
        .all()
        .map(({ sourceName }) => sourceName);
      return {
        id: feedback.id,
        feedbackType: feedback.feedbackType as BriefItemFeedbackType,
        topic: item.topic,
        headline: item.headline,
        sourceNames,
        occurredAt: feedback.updatedAt,
      };
    });
  }

  private userOwnsBrief(userId: string, briefId: string): boolean {
    return Boolean(
      this.db
        .select({ id: briefs.id })
        .from(briefs)
        .where(and(eq(briefs.id, briefId), eq(briefs.userId, userId)))
        .get(),
    );
  }

  private userOwnsItem(userId: string, briefItemId: string): boolean {
    return Boolean(
      this.db
        .select({ id: briefItems.id })
        .from(briefItems)
        .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
        .where(and(eq(briefItems.id, briefItemId), eq(briefs.userId, userId)))
        .get(),
    );
  }

  private mapBriefFeedback(row: typeof briefFeedback.$inferSelect): BriefFeedback {
    return {
      ...row,
      usefulness: row.usefulness as BriefFeedback["usefulness"],
      lengthRating: row.lengthRating as BriefFeedback["lengthRating"],
    };
  }

  private mapItemFeedback(row: typeof briefItemFeedback.$inferSelect): BriefItemFeedback {
    return {
      ...row,
      feedbackType: row.feedbackType as BriefItemFeedbackType,
    };
  }
}
