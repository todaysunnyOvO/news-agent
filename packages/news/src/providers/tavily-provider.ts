import type { NewsArticle, NewsSearchRequest, FetchedArticle } from "@news-agent/shared";

import { extractArticle } from "../extractors/article-extractor.js";
import { fetchSafeText } from "../network/safe-fetch.js";
import { canonicalizeUrl, createArticleId, hashContent } from "../normalize.js";
import type { NewsProvider } from "./provider.js";

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export type TavilyFetch = typeof fetch;

function dateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : undefined;
}

export class TavilyNewsProvider implements NewsProvider {
  public readonly id = "tavily";

  public constructor(
    private readonly apiKey: string,
    private readonly request: TavilyFetch = fetch,
  ) {
    if (!apiKey.trim()) throw new Error("Tavily API key is required");
  }

  public async search(input: NewsSearchRequest, signal?: AbortSignal): Promise<NewsArticle[]> {
    const response = await this.request("https://api.tavily.com/search", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: input.query,
        topic: "news",
        search_depth: "basic",
        max_results: input.limit ?? 10,
        include_published_date: true,
        filter_by_published_date: Boolean(input.from || input.to),
        ...(dateOnly(input.from) ? { start_date: dateOnly(input.from) } : {}),
        ...(dateOnly(input.to) ? { end_date: dateOnly(input.to) } : {}),
        ...(input.language ? { language: input.language, filter_by_language: true } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Tavily search failed with status ${response.status}`);
    const payload = await response.json() as TavilyResponse;
    const retrievedAt = new Date().toISOString();
    return (payload.results ?? []).flatMap((result) => {
      try {
        const canonicalUrl = canonicalizeUrl(result.url);
        const hostname = new URL(canonicalUrl).hostname.replace(/^www\./, "");
        return [{
          articleId: createArticleId(canonicalUrl),
          provider: this.id,
          sourceId: hostname,
          sourceName: hostname,
          title: result.title,
          canonicalUrl,
          publishedAt: result.published_date && Number.isFinite(Date.parse(result.published_date))
            ? new Date(result.published_date).toISOString()
            : retrievedAt,
          retrievedAt,
          language: input.language ?? "und",
          ...(result.content ? { summary: result.content } : {}),
        } satisfies NewsArticle];
      } catch {
        return [];
      }
    });
  }

  public async fetch(article: NewsArticle, signal?: AbortSignal): Promise<FetchedArticle> {
    try {
      const html = await fetchSafeText(article.canonicalUrl, signal);
      const extracted = extractArticle(html, article.canonicalUrl);
      const content = extracted.content || article.summary || "";
      return { ...article, content, contentHash: hashContent(content), truncated: extracted.truncated };
    } catch (error) {
      if (!article.summary) throw error;
      return { ...article, content: article.summary, contentHash: hashContent(article.summary), truncated: false };
    }
  }
}
