import { randomUUID } from "node:crypto";

import { asc, desc, eq, inArray } from "drizzle-orm";

import type { BriefDetail, BriefItemEvidenceStatus, BriefItemNovelty, BriefItemSection, NewsArticle, SaveBriefInput, SavedBrief } from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { agentRuns, articles, briefItems, briefItemSources, briefs, users } from "../schema.js";

export class BriefRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public findByRunId(runId: string): SavedBrief | undefined {
    const row = this.db.select().from(briefs).where(eq(briefs.runId, runId)).get();
    return row;
  }

  public listByUserId(userId: string, limit = 50): SavedBrief[] {
    return this.db
      .select()
      .from(briefs)
      .where(eq(briefs.userId, userId))
      .orderBy(desc(briefs.createdAt))
      .limit(limit)
      .all();
  }

  public findDetailById(briefId: string): BriefDetail | undefined {
    const brief = this.db.select().from(briefs).where(eq(briefs.id, briefId)).get();
    if (!brief) return undefined;
    const items = this.db
      .select()
      .from(briefItems)
      .where(eq(briefItems.briefId, briefId))
      .orderBy(asc(briefItems.rank))
      .all();

    return {
      ...brief,
      items: items.map((item) => {
        const rows = this.db
          .select({ article: articles })
          .from(briefItemSources)
          .innerJoin(articles, eq(briefItemSources.articleId, articles.id))
          .where(eq(briefItemSources.briefItemId, item.id))
          .all();
        const sources: NewsArticle[] = rows.map(({ article }) => ({
          articleId: article.id,
          provider: article.provider,
          sourceId: article.sourceId,
          sourceName: article.sourceName,
          title: article.title,
          canonicalUrl: article.canonicalUrl,
          publishedAt: article.publishedAt,
          retrievedAt: article.retrievedAt,
          language: article.language,
          ...(article.author ? { author: article.author } : {}),
          ...(article.eventTime ? { eventTime: article.eventTime } : {}),
          ...(article.summary ? { summary: article.summary } : {}),
        }));
        return {
          id: item.id,
          headline: item.headline,
          summary: item.summary,
          whyItMatters: item.whyItMatters,
          topic: item.topic,
          rank: item.rank,
          sources,
          ...(item.section ? { section: item.section as BriefItemSection } : {}),
          ...(item.novelty ? { novelty: item.novelty as BriefItemNovelty } : {}),
          ...(item.recommendationReason ? { recommendationReason: item.recommendationReason } : {}),
          ...(item.evidenceStatus ? { evidenceStatus: item.evidenceStatus as BriefItemEvidenceStatus } : {}),
        };
      }),
    };
  }

  public save(
    input: SaveBriefInput,
    options: { localDate: string; markdownPath: string },
  ): SavedBrief {
    const existing = this.findByRunId(input.runId);
    if (existing) return existing;

    const user = this.db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).get();
    if (!user) throw new Error("User not found");
    const run = this.db
      .select({ id: agentRuns.id, userId: agentRuns.userId })
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .get();
    if (!run || run.userId !== input.userId) throw new Error("Agent run not found for user");

    const sourceIds = [...new Set(input.items.flatMap((item) => item.sourceArticleIds))];
    const existingSources = sourceIds.length
      ? this.db.select({ id: articles.id }).from(articles).where(inArray(articles.id, sourceIds)).all()
      : [];
    if (existingSources.length !== sourceIds.length) throw new Error("Brief references unknown article IDs");

    const saved: SavedBrief = {
      id: randomUUID(),
      userId: input.userId,
      runId: input.runId,
      title: input.title,
      overview: input.overview,
      localDate: options.localDate,
      markdownPath: options.markdownPath,
      createdAt: new Date().toISOString(),
    };

    this.db.transaction((transaction) => {
      transaction.insert(briefs).values(saved).run();
      for (const [index, item] of input.items.entries()) {
        const itemId = randomUUID();
        transaction
          .insert(briefItems)
          .values({
            id: itemId,
            briefId: saved.id,
            headline: item.headline,
            summary: item.summary,
            whyItMatters: item.whyItMatters,
            topic: item.topic,
            rank: index + 1,
            section: item.section ?? null,
            novelty: item.novelty ?? null,
            recommendationReason: item.recommendationReason ?? null,
            evidenceStatus: item.evidenceStatus ?? null,
          })
          .run();
        if (item.sourceArticleIds.length > 0) {
          transaction
            .insert(briefItemSources)
            .values(item.sourceArticleIds.map((articleId) => ({ briefItemId: itemId, articleId })))
            .run();
        }
      }
    });
    return saved;
  }
}
