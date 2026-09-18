import type { NewsArticle } from "@news-agent/shared";

import { normalizeTitle } from "./normalize.js";

function titleTokens(title: string): Set<string> {
  const normalized = normalizeTitle(title);
  const wordTokens = normalized.split(" ").filter(Boolean);
  if (wordTokens.length > 1) return new Set(wordTokens);

  const characters = [...normalized.replaceAll(" ", "")];
  const bigrams = characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);
  return new Set(bigrams.length > 0 ? bigrams : characters);
}

export function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

export function deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
  const unique: NewsArticle[] = [];
  const urls = new Set<string>();

  for (const article of articles) {
    if (urls.has(article.canonicalUrl)) continue;
    if (unique.some((candidate) => candidate.sourceId === article.sourceId && titleSimilarity(candidate.title, article.title) >= 0.82)) continue;
    urls.add(article.canonicalUrl);
    unique.push(article);
  }
  return unique;
}

export function findRelatedArticles(
  article: NewsArticle,
  candidates: NewsArticle[],
  limit = 5,
): NewsArticle[] {
  return candidates
    .filter((candidate) => candidate.articleId !== article.articleId)
    .map((candidate) => ({ candidate, score: titleSimilarity(article.title, candidate.title) }))
    .filter(({ score }) => score >= 0.35)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
