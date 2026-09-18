import type { NewsArticle } from "@news-agent/shared";

import { normalizeTitle } from "./normalize.js";

export interface NewsEventCluster {
  id: string;
  articles: NewsArticle[];
  independentSourceCount: number;
  corroborated: boolean;
}

function terms(article: NewsArticle): string[] {
  const text = normalizeTitle(`${article.title} ${article.summary ?? ""}`);
  const words = text.split(/\s+/).filter((word) => word.length > 1);
  if (words.length > 1) return words;
  const characters = [...text.replaceAll(" ", "")];
  return characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`);
}

function termFrequency(article: NewsArticle): Map<string, number> {
  const values = terms(article);
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const [value, count] of counts) counts.set(value, count / Math.max(1, values.length));
  return counts;
}

export function semanticSimilarity(left: NewsArticle, right: NewsArticle): number {
  const leftFrequency = termFrequency(left);
  const rightFrequency = termFrequency(right);
  const vocabulary = new Set([...leftFrequency.keys(), ...rightFrequency.keys()]);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const term of vocabulary) {
    const leftValue = leftFrequency.get(term) ?? 0;
    const rightValue = rightFrequency.get(term) ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue ** 2;
    rightMagnitude += rightValue ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export function clusterNewsEvents(articles: NewsArticle[], threshold = 0.42): NewsEventCluster[] {
  const groups: NewsArticle[][] = [];
  for (const article of articles) {
    const group = groups.find((candidate) => candidate.some((item) => semanticSimilarity(item, article) >= threshold));
    if (group) group.push(article);
    else groups.push([article]);
  }
  return groups.map((items) => {
    const independentSourceCount = new Set(items.map((item) => item.sourceId)).size;
    return {
      id: items.map((item) => item.articleId).sort().join(":").slice(0, 96),
      articles: items,
      independentSourceCount,
      corroborated: independentSourceCount >= 2,
    };
  });
}
