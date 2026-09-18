import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import type { NewsDatabase } from "../database.js";
import { agentRuns } from "../schema.js";

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentRun = typeof agentRuns.$inferSelect;
export interface AgentRunMetrics {
  turnCount: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class AgentRunRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public create(
    userId: string,
    model = "test-model",
    trigger = "manual",
    idempotencyKey?: string,
  ): string {
    const id = randomUUID();
    this.db
      .insert(agentRuns)
      .values({ id, userId, model, trigger, status: "queued", toolCallCount: 0, idempotencyKey })
      .run();
    return id;
  }

  public findById(id: string): AgentRun | undefined {
    return this.db.select().from(agentRuns).where(eq(agentRuns.id, id)).get();
  }

  public findByIdempotencyKey(key: string): AgentRun | undefined {
    return this.db.select().from(agentRuns).where(eq(agentRuns.idempotencyKey, key)).get();
  }

  public listByUserId(userId: string, limit = 50): AgentRun[] {
    return this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.userId, userId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit)
      .all();
  }

  public hasActiveOrSucceededIdempotencyKey(key: string): boolean {
    return Boolean(this.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(
        eq(agentRuns.idempotencyKey, key),
        inArray(agentRuns.status, ["queued", "running", "succeeded"]),
      ))
      .get());
  }

  public markRunning(id: string): void {
    this.db
      .update(agentRuns)
      .set({ status: "running", startedAt: new Date().toISOString(), errorMessage: null })
      .where(eq(agentRuns.id, id))
      .run();
  }

  public finish(
    id: string,
    status: Exclude<AgentRunStatus, "queued" | "running">,
    toolCallCount: number,
    errorMessage?: string,
    metrics?: AgentRunMetrics,
  ): void {
    this.db
      .update(agentRuns)
      .set({
        status,
        finishedAt: new Date().toISOString(),
        toolCallCount,
        ...(metrics ? {
          turnCount: metrics.turnCount,
          durationMs: metrics.durationMs,
          inputTokens: metrics.inputTokens,
          outputTokens: metrics.outputTokens,
          costUsdMicros: Math.round(metrics.costUsd * 1_000_000),
        } : {}),
        errorMessage: errorMessage ?? null,
      })
      .where(eq(agentRuns.id, id))
      .run();
  }
}
