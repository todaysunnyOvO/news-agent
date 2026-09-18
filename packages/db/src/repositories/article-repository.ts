import { desc, eq } from "drizzle-orm";

import type { FetchedArticle, NewsArticle } from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { articles } from "../schema.js";

type ArticleRow = typeof articles.$inferSelect;

function toArticle(row: ArticleRow): NewsArticle {
  return {
    articleId: row.id,
    provider: row.provider,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    title: row.title,
    canonicalUrl: row.canonicalUrl,
    publishedAt: row.publishedAt,
    retrievedAt: row.retrievedAt,
    language: row.language,
    ...(row.author ? { author: row.author } : {}),
    ...(row.eventTime ? { eventTime: row.eventTime } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
  };
}

export class ArticleRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public upsertMany(items: NewsArticle[]): NewsArticle[] {
    for (const article of items) {
      this.db
        .insert(articles)
        .values({
          id: article.articleId,
          provider: article.provider,
          sourceId: article.sourceId,
          sourceName: article.sourceName,
          title: article.title,
          canonicalUrl: article.canonicalUrl,
          author: article.author,
          language: article.language,
          publishedAt: article.publishedAt,
          eventTime: article.eventTime,
          summary: article.summary,
          retrievedAt: article.retrievedAt,
        })
        .onConflictDoUpdate({
          target: articles.canonicalUrl,
          set: {
            provider: article.provider,
            sourceId: article.sourceId,
            sourceName: article.sourceName,
            title: article.title,
            author: article.author,
            language: article.language,
            publishedAt: article.publishedAt,
            eventTime: article.eventTime,
            summary: article.summary,
            retrievedAt: article.retrievedAt,
          },
        })
        .run();
    }
    return items;
  }

  public findById(articleId: string): NewsArticle | undefined {
    const row = this.db.select().from(articles).where(eq(articles.id, articleId)).get();
    return row ? toArticle(row) : undefined;
  }

  public findFetchedById(articleId: string): FetchedArticle | undefined {
    const row = this.db.select().from(articles).where(eq(articles.id, articleId)).get();
    if (!row?.content || !row.contentHash) return undefined;
    return {
      ...toArticle(row),
      content: row.content,
      contentHash: row.contentHash,
      truncated: false,
    };
  }

  public updateContent(article: FetchedArticle): void {
    this.db
      .update(articles)
      .set({
        content: article.content,
        contentHash: article.contentHash,
        author: article.author,
        summary: article.summary,
      })
      .where(eq(articles.id, article.articleId))
      .run();
  }

  public listRecent(limit = 100): NewsArticle[] {
    return this.db
      .select()
      .from(articles)
      .orderBy(desc(articles.publishedAt))
      .limit(limit)
      .all()
      .map(toArticle);
  }
}

