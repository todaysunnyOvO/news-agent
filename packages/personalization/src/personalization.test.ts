import { describe, expect, it } from "vitest";

import type { InferredPreference, NewsArticle, Subscription } from "@news-agent/shared";

import { aggregateSignals, decayMultiplier, type PersonalizationSignal } from "./aggregator.js";
import { rankCandidates, scoreCandidate } from "./scorer.js";

const now = new Date("2026-09-18T08:00:00.000Z");

function article(id: string, title: string, sourceName = "News Desk", sourceId = "news"): NewsArticle {
  return {
    articleId: id,
    provider: "fixture",
    sourceId,
    sourceName,
    title,
    canonicalUrl: `https://example.com/${id}`,
    publishedAt: "2026-09-18T07:00:00.000Z",
    retrievedAt: "2026-09-18T08:00:00.000Z",
    language: "zh-CN",
  };
}

const subscription: Subscription = {
  id: "subscription",
  userId: "user",
  topics: [],
  keywords: [],
  excludedKeywords: [],
  languages: ["zh-CN"],
  sourceIds: [],
  maxItems: 5,
  scheduleCron: "0 8 * * *",
  timezone: "Asia/Shanghai",
  deliveryChannel: "web",
  enabled: true,
  pausedUntil: null,
  skipDates: [],
  personalizationEnabled: true,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

function preference(value: string, weight: number): InferredPreference {
  return {
    id: value,
    userId: "user",
    kind: "topic",
    value,
    weight,
    confidence: 1,
    status: "accepted",
    evidenceCount: 2,
    evidenceIds: ["one", "two"],
    lastReinforcedAt: now.toISOString(),
    expiresAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

describe("personalization replay", () => {
  it("decays evidence by half after the configured half life", () => {
    expect(decayMultiplier("2026-08-19T08:00:00.000Z", now)).toBeCloseTo(0.5, 5);
  });

  it("aggregates repeated feedback but keeps already-known separate from topic interest", () => {
    const signals: PersonalizationSignal[] = [
      { id: "one", source: "feedback", topic: "AI Agent", sourceNames: [], feedbackType: "useful", occurredAt: "2026-09-17T08:00:00.000Z" },
      { id: "two", source: "feedback", topic: "AI Agent", sourceNames: [], feedbackType: "useful", occurredAt: "2026-09-18T07:00:00.000Z" },
      { id: "three", source: "feedback", topic: "AI Agent", sourceNames: [], feedbackType: "already_known", occurredAt: "2026-09-17T08:00:00.000Z" },
      { id: "four", source: "feedback", topic: "AI Agent", sourceNames: [], feedbackType: "already_known", occurredAt: "2026-09-18T07:00:00.000Z" },
    ];
    const result = aggregateSignals(signals, now);
    expect(result.find((item) => item.kind === "topic")?.weight).toBeGreaterThan(1);
    expect(result.find((item) => item.kind === "freshness")?.weight).toBeLessThan(0);
  });

  it("produces deterministic profile-specific rankings", () => {
    const candidates = [article("agent", "AI Agent 发布工具"), article("chip", "AI 芯片发布工具")];
    const agentRanking = rankCandidates(candidates, subscription, [preference("AI Agent", 1)], now);
    const chipRanking = rankCandidates(candidates, subscription, [preference("AI 芯片", 1)], now);
    expect(agentRanking[0]?.article.articleId).toBe("agent");
    expect(chipRanking[0]?.article.articleId).toBe("chip");
    expect(rankCandidates(candidates, subscription, [preference("AI Agent", 1)], now)).toEqual(agentRanking);
  });

  it("never lets the major-news guard bypass an explicit exclusion", () => {
    const excluded = scoreCandidate(
      article("major", "官方发布重大安全禁令", "政府 official", "gov"),
      { ...subscription, excludedKeywords: ["禁令"] },
      [],
      now,
    );
    expect(excluded.excluded).toBe(true);
    expect(excluded.majorNewsGuard).toBe(false);
  });

  it("keeps authoritative high-impact news above ordinary unmatched news", () => {
    const ranked = rankCandidates([
      article("ordinary", "行业日常观察"),
      article("major", "官方发布重大安全监管", "政府 official", "gov"),
    ], subscription, [], now);
    expect(ranked[0]?.article.articleId).toBe("major");
    expect(ranked[0]?.majorNewsGuard).toBe(true);
  });
});
