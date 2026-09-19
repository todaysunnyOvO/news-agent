import type { FastifyInstance } from "fastify";

import { runFixedRankingBenchmark } from "@news-agent/personalization";
import type { VersionComparisonReport } from "@news-agent/shared";

import type { AppRepositories } from "../types.js";

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
  },
} as const;

function period(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from >= to) throw new Error("The metrics 'from' time must be before 'to'");
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function registerAnalyticsRoutes(app: FastifyInstance, repositories: AppRepositories): Promise<void> {
  app.get<{ Params: { userId: string }; Querystring: { from?: string; to?: string } }>(
    "/api/users/:userId/metrics",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) {
        return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User not found", statusCode: 404 });
      }
      try {
        const { from, to } = period(request.query);
        return repositories.reporting.snapshot(request.params.userId, from, to);
      } catch (error) {
        return reply.code(400).send({ error: "INVALID_PERIOD", message: error instanceof Error ? error.message : "Invalid period", statusCode: 400 });
      }
    },
  );

  app.get<{ Params: { userId: string }; Querystring: { from?: string; to?: string } }>(
    "/api/users/:userId/version-comparison",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) {
        return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User not found", statusCode: 404 });
      }
      try {
        const { from, to } = period(request.query);
        const duration = Date.parse(to) - Date.parse(from);
        const baselineTo = from;
        const baselineFrom = new Date(Date.parse(from) - duration).toISOString();
        const current = repositories.reporting.snapshot(request.params.userId, from, to);
        const baseline = repositories.reporting.snapshot(request.params.userId, baselineFrom, baselineTo);
        const report: VersionComparisonReport = {
          current,
          baseline,
          changes: {
            briefUsefulRate: current.quality.briefUsefulRate - baseline.quality.briefUsefulRate,
            itemUsefulRate: current.quality.itemUsefulRate - baseline.quality.itemUsefulRate,
            deliverySuccessRate: current.reliability.deliverySuccessRate - baseline.reliability.deliverySuccessRate,
            averageDurationMs: current.performance.averageDurationMs - baseline.performance.averageDurationMs,
            averageCostPerSelectedItemUsd: current.performance.averageCostPerSelectedItemUsd - baseline.performance.averageCostPerSelectedItemUsd,
          },
          versions: { prompt: "r2.1", ranking: "r2-personalization-v1", report: "r2-metrics-v1" },
          offlineBenchmark: runFixedRankingBenchmark(),
        };
        return report;
      } catch (error) {
        return reply.code(400).send({ error: "INVALID_PERIOD", message: error instanceof Error ? error.message : "Invalid period", statusCode: 400 });
      }
    },
  );
}
