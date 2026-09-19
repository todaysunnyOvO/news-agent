import { eq, inArray } from "drizzle-orm";

import type { MetricsSnapshot } from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import {
  agentRuns,
  articles,
  briefFeedback,
  briefItemFeedback,
  briefItems,
  briefItemSources,
  briefs,
  deliveryJobs,
  savedItems,
  trackedTopics,
} from "../schema.js";

function rate(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function inRange(value: string | null, from: string, to: string): boolean {
  return Boolean(value && value >= from && value < to);
}

export class ReportingRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public snapshot(userId: string, from: string, to: string): MetricsSnapshot {
    const periodBriefs = this.db.select().from(briefs).where(eq(briefs.userId, userId)).all()
      .filter((brief) => inRange(brief.createdAt, from, to));
    const briefIds = periodBriefs.map((brief) => brief.id);
    const items = briefIds.length
      ? this.db.select().from(briefItems).where(inArray(briefItems.briefId, briefIds)).all()
      : [];
    const itemIds = items.map((item) => item.id);
    const sourceRows = itemIds.length
      ? this.db.select({ briefItemId: briefItemSources.briefItemId, sourceId: articles.sourceId })
          .from(briefItemSources)
          .innerJoin(articles, eq(briefItemSources.articleId, articles.id))
          .where(inArray(briefItemSources.briefItemId, itemIds)).all()
      : [];
    const sourcesByItem = new Map<string, Set<string>>();
    for (const row of sourceRows) {
      const sources = sourcesByItem.get(row.briefItemId) ?? new Set<string>();
      sources.add(row.sourceId);
      sourcesByItem.set(row.briefItemId, sources);
    }

    const briefRatings = briefIds.length
      ? this.db.select().from(briefFeedback).where(inArray(briefFeedback.briefId, briefIds)).all().filter((row) => row.userId === userId)
      : [];
    const itemRatings = itemIds.length
      ? this.db.select().from(briefItemFeedback).where(inArray(briefItemFeedback.briefItemId, itemIds)).all().filter((row) => row.userId === userId && row.active)
      : [];
    const saves = itemIds.length
      ? this.db.select().from(savedItems).where(inArray(savedItems.briefItemId, itemIds)).all().filter((row) => row.userId === userId)
      : [];
    const tracks = itemIds.length
      ? this.db.select().from(trackedTopics).where(inArray(trackedTopics.sourceBriefItemId, itemIds)).all().filter((row) => row.userId === userId)
      : [];

    const runs = this.db.select().from(agentRuns).where(eq(agentRuns.userId, userId)).all()
      .filter((run) => inRange(run.startedAt ?? run.finishedAt, from, to));
    const deliveries = this.db.select().from(deliveryJobs).where(eq(deliveryJobs.userId, userId)).all()
      .filter((job) => inRange(job.createdAt, from, to));
    const succeededRuns = runs.filter((run) => run.status === "succeeded");
    const scheduledRuns = runs.filter((run) => run.trigger === "scheduled");
    const delivered = deliveries.filter((job) => job.status === "succeeded");
    const uniqueDeliveryKeys = new Set(deliveries.map((job) => `${job.runId}:${job.channel}`));
    const periodRunIdsWithBrief = new Set(periodBriefs.map((brief) => brief.runId));
    const totalCostUsd = runs.reduce((sum, run) => sum + run.costUsdMicros / 1_000_000, 0);

    return {
      userId,
      from,
      to,
      quality: {
        briefCount: periodBriefs.length,
        itemCount: items.length,
        averageItemsPerBrief: rate(items.length, periodBriefs.length),
        briefUsefulRate: rate(briefRatings.filter((row) => row.usefulness === "useful").length, briefRatings.filter((row) => row.usefulness !== null).length),
        itemUsefulRate: rate(itemRatings.filter((row) => row.feedbackType === "useful").length, itemRatings.length),
        notInterestedRate: rate(itemRatings.filter((row) => row.feedbackType === "not_interested").length, itemRatings.length),
        alreadyKnownRate: rate(itemRatings.filter((row) => row.feedbackType === "already_known").length, itemRatings.length),
        repetitiveRate: rate(itemRatings.filter((row) => row.feedbackType === "repetitive").length, itemRatings.length),
        savedRate: rate(new Set(saves.map((row) => row.briefItemId)).size, items.length),
        trackedRate: rate(new Set(tracks.map((row) => row.sourceBriefItemId)).size, items.length),
        sourceCoverage: rate(items.filter((item) => (sourcesByItem.get(item.id)?.size ?? 0) > 0).length, items.length),
        multiSourceCoverage: rate(items.filter((item) => (sourcesByItem.get(item.id)?.size ?? 0) >= 2).length, items.length),
      },
      reliability: {
        scheduledRunCount: scheduledRuns.length,
        generationSuccessRate: rate(succeededRuns.length, runs.length),
        deliverySuccessRate: rate(delivered.length, deliveries.length),
        firstAttemptSuccessRate: rate(delivered.filter((job) => job.attemptCount === 1).length, deliveries.length),
        averageDeliveryAttempts: average(deliveries.map((job) => job.attemptCount)),
        duplicateDeliveryCount: deliveries.length - uniqueDeliveryKeys.size,
        missedBriefCount: scheduledRuns.filter((run) => run.status === "succeeded" && !periodRunIdsWithBrief.has(run.id)).length,
      },
      performance: {
        averageDurationMs: average(runs.flatMap((run) => run.durationMs === null ? [] : [run.durationMs])),
        averageTurns: average(runs.map((run) => run.turnCount)),
        averageToolCalls: average(runs.map((run) => run.toolCallCount)),
        inputTokens: runs.reduce((sum, run) => sum + run.inputTokens, 0),
        outputTokens: runs.reduce((sum, run) => sum + run.outputTokens, 0),
        costUsd: totalCostUsd,
        averageCostPerSelectedItemUsd: rate(totalCostUsd, items.length),
      },
    };
  }
}
