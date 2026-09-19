import type { InferredPreference, NewsArticle, Subscription } from "@news-agent/shared";

import { rankCandidates } from "./scorer.js";

const FIXED_NOW = new Date("2026-09-18T08:00:00.000Z");

function article(articleId: string, title: string, sourceName = "News Desk", sourceId = "news"): NewsArticle {
  return {
    articleId, provider: "historical-fixture", sourceId, sourceName, title,
    canonicalUrl: `https://fixture.invalid/${articleId}`,
    publishedAt: "2026-09-18T07:00:00.000Z",
    retrievedAt: FIXED_NOW.toISOString(), language: "zh-CN",
  };
}

function subscription(excludedKeywords: string[] = []): Subscription {
  return {
    id: "fixture", userId: "fixture", topics: [], keywords: [], excludedKeywords,
    languages: ["zh-CN"], sourceIds: [], maxItems: 5, scheduleCron: "0 8 * * *",
    timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true, pausedUntil: null,
    skipDates: [], personalizationEnabled: true, createdAt: FIXED_NOW.toISOString(), updatedAt: FIXED_NOW.toISOString(),
  };
}

function preference(value: string): InferredPreference {
  return {
    id: value, userId: "fixture", kind: "topic", value, weight: 1, confidence: 1,
    status: "accepted", evidenceCount: 2, evidenceIds: ["one", "two"],
    lastReinforcedAt: FIXED_NOW.toISOString(), expiresAt: null,
    createdAt: FIXED_NOW.toISOString(), updatedAt: FIXED_NOW.toISOString(),
  };
}

export function runFixedRankingBenchmark() {
  const scenarios = [
    {
      id: "profile-ai-agent",
      expectedFirst: "agent",
      ranked: rankCandidates([article("chip", "AI 芯片行业观察"), article("agent", "AI Agent 工具发布")], subscription(), [preference("AI Agent")], FIXED_NOW),
    },
    {
      id: "major-news-guard",
      expectedFirst: "major",
      ranked: rankCandidates([article("ordinary", "普通行业观察"), article("major", "官方发布安全监管", "政府 official", "gov")], subscription(), [], FIXED_NOW),
    },
    {
      id: "explicit-exclusion",
      expectedFirst: null,
      ranked: rankCandidates([article("blocked", "官方发布安全禁令", "政府 official", "gov")], subscription(["禁令"]), [], FIXED_NOW),
    },
  ];
  const results = scenarios.map((scenario) => {
    const actualFirst = scenario.ranked[0]?.article.articleId ?? null;
    return { id: scenario.id, passed: actualFirst === scenario.expectedFirst, expectedFirst: scenario.expectedFirst, actualFirst };
  });
  const passedScenarios = results.filter((result) => result.passed).length;
  return { scenarioCount: results.length, passedScenarios, score: results.length ? passedScenarios / results.length : 0, results };
}
