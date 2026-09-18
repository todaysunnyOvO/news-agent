import { describe, expect, it } from "vitest";

import type { NewsArticle } from "@news-agent/shared";

import { deduplicateArticles, findRelatedArticles, titleSimilarity } from "./deduplicate.js";
import { clusterNewsEvents, semanticSimilarity } from "./event-clustering.js";
import { extractArticle } from "./extractors/article-extractor.js";
import { fetchSafeText } from "./network/safe-fetch.js";
import { canonicalizeUrl, hashContent, normalizeArticle } from "./normalize.js";
import { RssNewsProvider } from "./providers/rss-provider.js";
import { TavilyNewsProvider } from "./providers/tavily-provider.js";

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    articleId: "article-1",
    provider: "mock",
    sourceId: "source-1",
    sourceName: "Source",
    title: "Pi Agent releases a new research model",
    canonicalUrl: "https://example.com/news/pi-agent",
    publishedAt: "2026-09-17T00:00:00.000Z",
    retrievedAt: "2026-09-17T01:00:00.000Z",
    language: "en",
    ...overrides,
  };
}

describe("news normalization and deduplication", () => {
  it("canonicalizes tracking URLs and creates stable IDs", () => {
    const normalized = normalizeArticle(
      article({ canonicalUrl: "https://www.Example.com/news/pi-agent/?utm_source=test&b=2#top" }),
    );
    expect(normalized.canonicalUrl).toBe("https://example.com/news/pi-agent?b=2");
    expect(normalized.articleId).toHaveLength(32);
    expect(hashContent("  hello   world ")).toBe(hashContent("hello world"));
    expect(canonicalizeUrl("https://example.com/a/?fbclid=x")).toBe("https://example.com/a");
  });

  it("deduplicates by canonical URL and similar title", () => {
    const original = article();
    const sameUrl = article({ articleId: "article-2" });
    const similarTitle = article({
      articleId: "article-3",
      canonicalUrl: "https://another.example/story",
      title: "Pi Agent releases a new research model!",
    });
    expect(deduplicateArticles([original, sameUrl, similarTitle])).toEqual([original]);
    expect(titleSimilarity(original.title, similarTitle.title)).toBeGreaterThan(0.8);
  });

  it("finds related cached reports", () => {
    const original = article();
    const related = article({
      articleId: "related",
      canonicalUrl: "https://second.example/story",
      title: "New research model released by Pi Agent",
    });
    const unrelated = article({
      articleId: "other",
      canonicalUrl: "https://third.example/story",
      title: "Weather forecast for Shanghai",
    });
    expect(findRelatedArticles(original, [related, unrelated])).toEqual([related]);
  });
});

describe("semantic event clustering", () => {
  it("groups paraphrased reports and marks independent corroboration", () => {
    const first = article({ title: "Central bank cuts interest rates after inflation slows", summary: "Officials reduced rates after lower inflation." });
    const second = article({ articleId: "article-2", sourceId: "source-2", canonicalUrl: "https://other.example/rates", title: "Interest rates cut as inflation eases", summary: "The central bank lowered rates following slower inflation." });
    expect(semanticSimilarity(first, second)).toBeGreaterThan(0.4);
    const clusters = clusterNewsEvents([first, second]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ independentSourceCount: 2, corroborated: true });
  });
});

describe("article extraction", () => {
  it("extracts readable article text", () => {
    const html = `<!doctype html><html><head><title>AI News</title></head><body><article>
      <h1>AI News</h1><p>Pi Agent published a substantial research update for developers.</p>
      <p>The update includes tools, evaluations, and implementation details for production teams.</p>
    </article></body></html>`;
    const extracted = extractArticle(html, "https://example.com/article");
    expect(extracted.content).toContain("Pi Agent published");
    expect(extracted.truncated).toBe(false);
  });
});

describe("RSS provider", () => {
  it("parses and searches three configured feeds without network access", async () => {
    const sources = ["one", "two", "three"].map((id) => ({
      id,
      name: `Source ${id}`,
      url: `https://${id}.example/feed.xml`,
      language: "en",
    }));
    const fetchText = async (url: string): Promise<string> => {
      const source = sources.find((candidate) => candidate.url === url);
      if (!source) throw new Error("Unexpected URL");
      return `<?xml version="1.0"?><rss version="2.0"><channel><title>${source.name}</title>
        <item><title>AI Agent update from ${source.name}</title>
        <link>https://${source.id}.example/articles/update?utm_source=rss</link>
        <pubDate>Thu, 17 Sep 2026 08:00:00 GMT</pubDate>
        <description>AI Agent platform news</description></item></channel></rss>`;
    };
    const provider = new RssNewsProvider(sources, fetchText);
    const results = await provider.search({ query: "AI Agent", limit: 10 });

    expect(results).toHaveLength(3);
    expect(new Set(results.map((result) => result.sourceId))).toEqual(new Set(["one", "two", "three"]));
    expect(results.every((result) => !result.canonicalUrl.includes("utm_source"))).toBe(true);
  });

  it("falls back to the RSS summary when page extraction fails", async () => {
    const source = {
      id: "one",
      name: "Source one",
      url: "https://one.example/feed.xml",
      language: "en",
    };
    const provider = new RssNewsProvider([source], async (url) =>
      url.endsWith("feed.xml")
        ? `<?xml version="1.0"?><rss version="2.0"><channel><item><title>AI update</title>
           <link>https://one.example/article</link><pubDate>Thu, 17 Sep 2026 08:00:00 GMT</pubDate>
           <description>Useful fallback summary</description></item></channel></rss>`
        : "<html><body></body></html>",
    );
    const [result] = await provider.search({ query: "AI" });
    if (!result) throw new Error("Expected RSS result");
    const fetched = await provider.fetch(result);
    expect(fetched.content).toBe("Useful fallback summary");
  });
});

describe("safe network access", () => {
  it("rejects localhost before making a request", async () => {
    await expect(fetchSafeText("http://127.0.0.1/private")).rejects.toThrow("blocked network");
  });
});

describe("Tavily provider", () => {
  it("sends an authenticated news search and normalizes results", async () => {
    let authorization = "";
    const provider = new TavilyNewsProvider("secret-key", async (_url, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ results: [{
        title: "Agent platform update",
        url: "https://news.example/story?utm_source=search",
        content: "A verified update.",
        published_date: "2026-09-18T08:00:00Z",
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const results = await provider.search({ query: "agent", language: "en", limit: 3 });
    expect(authorization).toBe("Bearer secret-key");
    expect(results[0]?.canonicalUrl).toBe("https://news.example/story");
    expect(results[0]?.provider).toBe("tavily");
  });
});
