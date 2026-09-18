import type { InferredPreference, NewsArticle, Subscription } from "@news-agent/shared";

export interface CandidateScore {
  article: NewsArticle;
  score: number;
  reasons: string[];
  majorNewsGuard: boolean;
  excluded: boolean;
}

export function scoreCandidate(
  article: NewsArticle,
  subscription: Subscription,
  acceptedPreferences: InferredPreference[],
  now = new Date(),
): CandidateScore {
  const text = `${article.title} ${article.summary ?? ""}`.toLocaleLowerCase();
  const source = `${article.sourceId} ${article.sourceName}`.toLocaleLowerCase();
  const reasons: string[] = [];
  const excluded = subscription.excludedKeywords.some((keyword) => text.includes(keyword.toLocaleLowerCase()));
  if (excluded) return { article, score: Number.NEGATIVE_INFINITY, reasons: ["命中显式排除词"], majorNewsGuard: false, excluded: true };

  let score = 0;
  for (const topic of subscription.topics) {
    if (text.includes(topic.toLocaleLowerCase())) { score += 3; reasons.push(`匹配关注话题：${topic}`); }
  }
  for (const keyword of subscription.keywords) {
    if (text.includes(keyword.toLocaleLowerCase())) { score += 2; reasons.push(`匹配关键词：${keyword}`); }
  }
  if (subscription.sourceIds.some((id) => article.sourceId === id)) {
    score += 1.5;
    reasons.push("来自指定来源");
  }

  if (subscription.personalizationEnabled) {
    for (const preference of acceptedPreferences) {
      const matches = preference.kind === "source"
        ? source.includes(preference.value.toLocaleLowerCase())
        : preference.kind === "topic" || preference.kind === "keyword"
          ? text.includes(preference.value.toLocaleLowerCase())
          : false;
      if (matches) {
        score += preference.weight * preference.confidence * 2;
        reasons.push(`个性化偏好：${preference.value}`);
      }
      if (preference.kind === "freshness" && preference.weight < 0) {
        const ageHours = Math.max(0, now.getTime() - Date.parse(article.publishedAt)) / 3_600_000;
        score += Math.max(0, 1 - ageHours / 168) * Math.abs(preference.weight);
      }
    }
  }

  const ageHours = Math.max(0, now.getTime() - Date.parse(article.publishedAt)) / 3_600_000;
  score += Math.max(0, 2 - ageHours / 84);
  const majorNewsGuard = isMajorNews(article);
  if (majorNewsGuard && score < 5) {
    score = 5;
    reasons.push("重大新闻保底");
  }
  return { article, score, reasons, majorNewsGuard, excluded: false };
}

export function rankCandidates(
  articles: NewsArticle[],
  subscription: Subscription,
  acceptedPreferences: InferredPreference[],
  now = new Date(),
): CandidateScore[] {
  return articles
    .map((article) => scoreCandidate(article, subscription, acceptedPreferences, now))
    .filter((candidate) => !candidate.excluded)
    .sort((left, right) => right.score - left.score || Date.parse(right.article.publishedAt) - Date.parse(left.article.publishedAt));
}

function isMajorNews(article: NewsArticle): boolean {
  const source = `${article.sourceId} ${article.sourceName}`.toLocaleLowerCase();
  const title = article.title.toLocaleLowerCase();
  const authoritative = /official|政府|gov|研究院|university|公司博客|官方/.test(source);
  const highImpact = /\b(release|launch|regulation|ban|acqui|open.source|security)\b|发布|推出|监管|禁令|收购|开源|安全/.test(title);
  return authoritative && highImpact;
}
