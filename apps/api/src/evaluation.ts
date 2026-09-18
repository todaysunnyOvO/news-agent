import type { AgentRun, BriefRepository } from "@news-agent/db";

export interface RunEvaluationReport {
  runId: string;
  status: string;
  quality: {
    score: number;
    itemCount: number;
    sourceCoverage: number;
    multiSourceCoverage: number;
    uniqueSourceCount: number;
  };
  performance: {
    durationMs: number | null;
    turns: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export function evaluateRun(run: AgentRun, briefs: BriefRepository): RunEvaluationReport {
  const saved = briefs.findByRunId(run.id);
  const detail = saved ? briefs.findDetailById(saved.id) : undefined;
  const items = detail?.items ?? [];
  const sourced = items.filter((item) => item.sources.length > 0).length;
  const multiSource = items.filter((item) => new Set(item.sources.map((source) => source.sourceId)).size >= 2).length;
  const sourceCoverage = items.length ? sourced / items.length : 0;
  const multiSourceCoverage = items.length ? multiSource / items.length : 0;
  const uniqueSourceCount = new Set(items.flatMap((item) => item.sources.map((source) => source.sourceId))).size;
  const score = Math.round((sourceCoverage * 0.5 + multiSourceCoverage * 0.3 + (run.status === "succeeded" ? 0.2 : 0)) * 100);
  return {
    runId: run.id,
    status: run.status,
    quality: { score, itemCount: items.length, sourceCoverage, multiSourceCoverage, uniqueSourceCount },
    performance: {
      durationMs: run.durationMs,
      turns: run.turnCount,
      toolCalls: run.toolCallCount,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsdMicros / 1_000_000,
    },
  };
}
