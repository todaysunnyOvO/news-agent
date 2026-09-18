import type { BriefItemFeedbackType, InferredPreferenceKind } from "@news-agent/shared";
import type { PreferenceSuggestion } from "@news-agent/db";

export interface PersonalizationSignal {
  id: string;
  source: "feedback" | "saved" | "tracked";
  topic: string;
  sourceNames: string[];
  feedbackType?: BriefItemFeedbackType;
  occurredAt: string;
}

interface WeightedEvidence {
  id: string;
  kind: InferredPreferenceKind;
  value: string;
  weight: number;
  occurredAt: string;
}

export function decayMultiplier(occurredAt: string, now: Date, halfLifeDays = 30): number {
  const ageMs = Math.max(0, now.getTime() - Date.parse(occurredAt));
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return 0.5 ** (ageDays / halfLifeDays);
}

export function aggregateSignals(
  signals: PersonalizationSignal[],
  now = new Date(),
): PreferenceSuggestion[] {
  const evidence = signals.flatMap((signal) => toEvidence(signal));
  const groups = new Map<string, WeightedEvidence[]>();
  for (const item of evidence) {
    const key = `${item.kind}\u0000${item.value.toLocaleLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.values()].flatMap((items) => {
    const evidenceIds = [...new Set(items.map((item) => item.id))];
    if (evidenceIds.length < 2) return [];
    const weighted = items.map((item) => item.weight * decayMultiplier(item.occurredAt, now));
    const weight = clamp(weighted.reduce((sum, value) => sum + value, 0), -2, 2);
    if (Math.abs(weight) < 0.2) return [];
    const lastReinforcedAt = items
      .map((item) => item.occurredAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0]!;
    const confidence = clamp((evidenceIds.length / 5) * decayMultiplier(lastReinforcedAt, now, 60), 0.1, 1);
    return [{
      kind: items[0]!.kind,
      value: items[0]!.value,
      weight,
      confidence,
      evidenceIds,
      lastReinforcedAt,
      expiresAt: new Date(Date.parse(lastReinforcedAt) + 90 * 24 * 60 * 60 * 1000).toISOString(),
    }];
  });
}

export function summarizeNegativeSignals(signals: PersonalizationSignal[], now = new Date()) {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const groups = new Map<string, { topic: string; reason: "not_interested" | "already_known" | "repetitive"; count: number }>();
  for (const signal of signals) {
    if (!signal.feedbackType || !["not_interested", "already_known", "repetitive"].includes(signal.feedbackType)) continue;
    if (Date.parse(signal.occurredAt) < cutoff) continue;
    const reason = signal.feedbackType as "not_interested" | "already_known" | "repetitive";
    const key = `${signal.topic}\u0000${reason}`;
    const current = groups.get(key);
    groups.set(key, { topic: signal.topic, reason, count: (current?.count ?? 0) + 1 });
  }
  return [...groups.values()].sort((left, right) => right.count - left.count).slice(0, 10);
}

function toEvidence(signal: PersonalizationSignal): WeightedEvidence[] {
  const topic = signal.topic.trim();
  if (signal.source === "saved" || signal.source === "tracked") {
    return topic ? [{ id: signal.id, kind: "topic", value: topic, weight: signal.source === "tracked" ? 1.2 : 0.8, occurredAt: signal.occurredAt }] : [];
  }
  if (signal.feedbackType === "already_known") {
    return [{ id: signal.id, kind: "freshness", value: "novelty", weight: -0.5, occurredAt: signal.occurredAt }];
  }
  if (signal.feedbackType === "repetitive") {
    return [{ id: signal.id, kind: "freshness", value: "cross_day_repetition", weight: -0.8, occurredAt: signal.occurredAt }];
  }
  const direction = signal.feedbackType === "useful" ? 1 : -1;
  return [
    ...(topic ? [{ id: signal.id, kind: "topic" as const, value: topic, weight: direction, occurredAt: signal.occurredAt }] : []),
    ...signal.sourceNames.map((value) => ({ id: signal.id, kind: "source" as const, value, weight: direction * 0.35, occurredAt: signal.occurredAt })),
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
