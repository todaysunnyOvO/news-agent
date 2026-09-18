import { createHash } from "node:crypto";

import type { NewsArticle } from "@news-agent/shared";

const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
]);

export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.hostname = url.hostname.toLocaleLowerCase();
  if (url.hostname.startsWith("www.")) url.hostname = url.hostname.slice(4);

  for (const key of [...url.searchParams.keys()]) {
    if (key.toLocaleLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLocaleLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(content: string): string {
  return content.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeText(content)).digest("hex");
}

export function createArticleId(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 32);
}

export function normalizeArticle(article: NewsArticle): NewsArticle {
  const canonicalUrl = canonicalizeUrl(article.canonicalUrl);
  return {
    ...article,
    articleId: createArticleId(canonicalUrl),
    canonicalUrl,
    title: normalizeText(article.title),
    ...(article.author ? { author: normalizeText(article.author) } : {}),
    ...(article.summary ? { summary: normalizeText(article.summary) } : {}),
  };
}

