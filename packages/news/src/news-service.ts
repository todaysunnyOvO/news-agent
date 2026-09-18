import type { FetchedArticle, NewsArticle, NewsSearchRequest } from "@news-agent/shared";

import { deduplicateArticles, findRelatedArticles } from "./deduplicate.js";
import { hashContent, normalizeArticle } from "./normalize.js";
import type { NewsProvider } from "./providers/provider.js";

export class NewsService {
  private readonly providers: Map<string, NewsProvider>;

  public constructor(providers: NewsProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    if (this.providers.size !== providers.length) throw new Error("News provider IDs must be unique");
  }

  public async search(request: NewsSearchRequest, signal?: AbortSignal): Promise<NewsArticle[]> {
    const results = await Promise.allSettled(
      [...this.providers.values()].map((provider) => provider.search(request, signal)),
    );
    const articles = results
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .map(normalizeArticle);
    if (articles.length === 0 && results.length > 0 && results.every((result) => result.status === "rejected")) {
      throw new AggregateError(
        results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
        "All news providers failed",
      );
    }

    return deduplicateArticles(articles)
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
      .slice(0, request.limit ?? 10);
  }

  public async fetch(article: NewsArticle, signal?: AbortSignal): Promise<FetchedArticle> {
    const provider = this.providers.get(article.provider);
    if (!provider) throw new Error(`News provider is not registered: ${article.provider}`);
    const fetched = await provider.fetch(article, signal);
    return {
      ...fetched,
      contentHash: fetched.contentHash || hashContent(fetched.content),
    };
  }

  public findRelated(article: NewsArticle, candidates: NewsArticle[], limit = 5): NewsArticle[] {
    return findRelatedArticles(article, candidates, limit);
  }
}

