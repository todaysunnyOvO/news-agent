import type { FetchedArticle, NewsArticle, NewsSearchRequest } from "@news-agent/shared";

export interface NewsProvider {
  readonly id: string;
  search(request: NewsSearchRequest, signal?: AbortSignal): Promise<NewsArticle[]>;
  fetch(article: NewsArticle, signal?: AbortSignal): Promise<FetchedArticle>;
}

