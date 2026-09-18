import type { FetchedArticle, NewsArticle, NewsSearchRequest } from "@news-agent/shared";

import type { NewsProvider } from "./provider.js";
import { hashContent } from "../normalize.js";

export interface MockProviderFixture {
  article: NewsArticle;
  content: string;
}

export class MockNewsProvider implements NewsProvider {
  public readonly id = "mock";

  public constructor(private readonly fixtures: MockProviderFixture[]) {}

  public async search(request: NewsSearchRequest, signal?: AbortSignal): Promise<NewsArticle[]> {
    if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
    const query = request.query.toLocaleLowerCase();
    const from = request.from ? Date.parse(request.from) : Number.NEGATIVE_INFINITY;
    const to = request.to ? Date.parse(request.to) : Number.POSITIVE_INFINITY;
    const limit = request.limit ?? 10;

    return this.fixtures
      .map((fixture) => fixture.article)
      .filter((article) => {
        const haystack = `${article.title} ${article.summary ?? ""}`.toLocaleLowerCase();
        const publishedAt = Date.parse(article.publishedAt);
        return (
          haystack.includes(query) &&
          publishedAt >= from &&
          publishedAt <= to &&
          (!request.language || article.language === request.language) &&
          (!request.sourceIds?.length || request.sourceIds.includes(article.sourceId))
        );
      })
      .slice(0, limit);
  }

  public async fetch(article: NewsArticle, signal?: AbortSignal): Promise<FetchedArticle> {
    if (signal?.aborted) throw signal.reason ?? new Error("Fetch aborted");
    const fixture = this.fixtures.find((candidate) => candidate.article.articleId === article.articleId);
    if (!fixture) throw new Error(`Mock article not found: ${article.articleId}`);

    return {
      ...fixture.article,
      content: fixture.content,
      contentHash: hashContent(fixture.content),
      truncated: false,
    };
  }
}
