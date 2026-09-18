import Parser from "rss-parser";

import type { FetchedArticle, NewsArticle, NewsSearchRequest } from "@news-agent/shared";

import { extractArticle } from "../extractors/article-extractor.js";
import { fetchSafeText } from "../network/safe-fetch.js";
import { canonicalizeUrl, createArticleId, hashContent, normalizeText } from "../normalize.js";
import type { NewsProvider } from "./provider.js";

export interface RssSource {
  id: string;
  name: string;
  url: string;
  language: string;
}

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  creator?: string;
  author?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
}

export type FetchText = (url: string, signal?: AbortSignal) => Promise<string>;

export class RssNewsProvider implements NewsProvider {
  public readonly id = "rss";
  private readonly parser = new Parser<Record<string, never>, RssItem>();

  public constructor(
    private readonly sources: RssSource[],
    private readonly fetchText: FetchText = fetchSafeText,
  ) {
    const ids = new Set(sources.map((source) => source.id));
    if (ids.size !== sources.length) throw new Error("RSS source IDs must be unique");
  }

  public async search(request: NewsSearchRequest, signal?: AbortSignal): Promise<NewsArticle[]> {
    const selectedSources = this.sources.filter(
      (source) =>
        (!request.sourceIds?.length || request.sourceIds.includes(source.id)) &&
        (!request.language || request.language === source.language),
    );
    const results = await Promise.allSettled(
      selectedSources.map((source) => this.searchSource(source, request, signal)),
    );
    const articles = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (selectedSources.length > 0 && articles.length === 0 && results.every((result) => result.status === "rejected")) {
      throw new AggregateError(
        results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
        "All RSS sources failed",
      );
    }
    return articles
      .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
      .slice(0, request.limit ?? 10);
  }

  private async searchSource(
    source: RssSource,
    request: NewsSearchRequest,
    signal?: AbortSignal,
  ): Promise<NewsArticle[]> {
    const xml = await this.fetchText(source.url, signal);
    const feed = await this.parser.parseString(xml);
    const retrievedAt = new Date().toISOString();
    const tokens = request.query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const from = request.from ? Date.parse(request.from) : Number.NEGATIVE_INFINITY;
    const to = request.to ? Date.parse(request.to) : Number.POSITIVE_INFINITY;

    return feed.items.flatMap((item) => {
      const title = normalizeText(item.title ?? "");
      const link = item.link ?? item.guid;
      const publishedAt = new Date(item.isoDate ?? item.pubDate ?? "").getTime();
      const summary = normalizeText(item.contentSnippet ?? item.summary ?? item.content ?? "");
      const haystack = `${title} ${summary}`.toLocaleLowerCase();

      if (!title || !link || !Number.isFinite(publishedAt)) return [];
      if (publishedAt < from || publishedAt > to) return [];
      if (tokens.length > 0 && !tokens.every((token) => haystack.includes(token))) return [];

      const canonicalUrl = canonicalizeUrl(link);
      const article: NewsArticle = {
        articleId: createArticleId(canonicalUrl),
        provider: this.id,
        sourceId: source.id,
        sourceName: source.name,
        title,
        canonicalUrl,
        publishedAt: new Date(publishedAt).toISOString(),
        retrievedAt,
        language: source.language,
        ...(item.creator || item.author
          ? { author: normalizeText(item.creator ?? item.author ?? "") }
          : {}),
        ...(summary ? { summary } : {}),
      };
      return [article];
    });
  }

  public async fetch(article: NewsArticle, signal?: AbortSignal): Promise<FetchedArticle> {
    const html = await this.fetchText(article.canonicalUrl, signal);
    let content: string;
    let truncated = false;
    try {
      const extracted = extractArticle(html, article.canonicalUrl);
      content = extracted.content;
      truncated = extracted.truncated;
    } catch (error) {
      if (!article.summary) throw new Error("Article extraction failed and no RSS summary is available", { cause: error });
      content = article.summary;
    }

    return {
      ...article,
      content,
      contentHash: hashContent(content),
      truncated,
    };
  }
}

