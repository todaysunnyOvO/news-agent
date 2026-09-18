import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import type {
  DeliveryAttemptRecord,
  DeliveryJob,
  DeliveryJobStatus,
} from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { deliveryAttempts, deliveryJobs } from "../schema.js";

interface CreateDeliveryJobInput {
  briefId: string;
  runId: string;
  userId: string;
  channel: "email" | "webhook";
  destinationHash: string;
  idempotencyKey: string;
}

function toJob(row: typeof deliveryJobs.$inferSelect): DeliveryJob {
  return {
    ...row,
    channel: row.channel as DeliveryJob["channel"],
    status: row.status as DeliveryJobStatus,
  };
}

function toAttempt(row: typeof deliveryAttempts.$inferSelect): DeliveryAttemptRecord {
  return {
    ...row,
    status: row.status as DeliveryAttemptRecord["status"],
  };
}

export class DeliveryRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public createJob(input: CreateDeliveryJobInput): DeliveryJob {
    const existing = this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db.insert(deliveryJobs).values({
      id: randomUUID(),
      ...input,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      deliveredAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }).run();
    const saved = this.findByIdempotencyKey(input.idempotencyKey);
    if (!saved) throw new Error("Delivery job was not persisted");
    return saved;
  }

  public findById(id: string): DeliveryJob | undefined {
    const row = this.db.select().from(deliveryJobs).where(eq(deliveryJobs.id, id)).get();
    return row ? toJob(row) : undefined;
  }

  public findByIdempotencyKey(key: string): DeliveryJob | undefined {
    const row = this.db.select().from(deliveryJobs).where(eq(deliveryJobs.idempotencyKey, key)).get();
    return row ? toJob(row) : undefined;
  }

  public findByRunAndChannel(runId: string, channel: string): DeliveryJob | undefined {
    const row = this.db.select().from(deliveryJobs).where(and(eq(deliveryJobs.runId, runId), eq(deliveryJobs.channel, channel))).get();
    return row ? toJob(row) : undefined;
  }

  public listByBriefId(briefId: string): DeliveryJob[] {
    return this.db.select().from(deliveryJobs).where(eq(deliveryJobs.briefId, briefId)).orderBy(asc(deliveryJobs.createdAt)).all().map(toJob);
  }

  public listAttempts(jobId: string): DeliveryAttemptRecord[] {
    return this.db.select().from(deliveryAttempts).where(eq(deliveryAttempts.deliveryJobId, jobId)).orderBy(asc(deliveryAttempts.attemptNumber)).all().map(toAttempt);
  }

  public listDue(now: Date, limit = 20): DeliveryJob[] {
    return this.db
      .select()
      .from(deliveryJobs)
      .where(and(
        inArray(deliveryJobs.status, ["pending", "sending"]),
        or(isNull(deliveryJobs.nextAttemptAt), lte(deliveryJobs.nextAttemptAt, now.toISOString())),
      ))
      .orderBy(asc(deliveryJobs.nextAttemptAt))
      .limit(limit)
      .all()
      .map(toJob);
  }

  public markSending(id: string): DeliveryJob | undefined {
    this.db.update(deliveryJobs).set({ status: "sending", updatedAt: new Date().toISOString() }).where(and(eq(deliveryJobs.id, id), inArray(deliveryJobs.status, ["pending", "sending"]))).run();
    return this.findById(id);
  }

  public recordAttempt(
    jobId: string,
    result: {
      success: boolean;
      durationMs: number;
      providerMessageId?: string;
      errorCode?: string;
      nextAttemptAt?: string;
    },
  ): DeliveryJob {
    const job = this.findById(jobId);
    if (!job) throw new Error("Delivery job not found");
    const now = new Date().toISOString();
    const attemptNumber = job.attemptCount + 1;
    this.db.transaction((transaction) => {
      transaction.insert(deliveryAttempts).values({
        id: randomUUID(),
        deliveryJobId: jobId,
        attemptNumber,
        status: result.success ? "succeeded" : "failed",
        providerMessageId: result.providerMessageId ?? null,
        errorCode: result.errorCode ?? null,
        durationMs: result.durationMs,
        createdAt: now,
      }).run();
      transaction.update(deliveryJobs).set({
        status: result.success ? "succeeded" : result.nextAttemptAt ? "pending" : "failed",
        attemptCount: attemptNumber,
        nextAttemptAt: result.success ? null : (result.nextAttemptAt ?? null),
        deliveredAt: result.success ? now : null,
        lastError: result.success ? null : (result.errorCode ?? "Delivery failed"),
        updatedAt: now,
      }).where(eq(deliveryJobs.id, jobId)).run();
    });
    return this.findById(jobId)!;
  }

  public prepareRetry(id: string): DeliveryJob | undefined {
    const job = this.findById(id);
    if (!job || job.status === "succeeded" || job.status === "cancelled") return undefined;
    this.db.update(deliveryJobs).set({
      status: "pending",
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      updatedAt: new Date().toISOString(),
    }).where(eq(deliveryJobs.id, id)).run();
    return this.findById(id);
  }
}
