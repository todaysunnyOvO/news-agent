import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { NewsDatabase } from "../database.js";
import { deliveryAttempts } from "../schema.js";

export type DeliveryAttempt = typeof deliveryAttempts.$inferSelect;

export class DeliveryRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public find(runId: string, channel: string): DeliveryAttempt | undefined {
    return this.db.select().from(deliveryAttempts).where(and(eq(deliveryAttempts.runId, runId), eq(deliveryAttempts.channel, channel))).get();
  }

  public record(runId: string, channel: string, status: "pending" | "delivered" | "failed", error?: string, incrementAttempt = true): DeliveryAttempt {
    const existing = this.find(runId, channel);
    const values = {
      id: existing?.id ?? randomUUID(),
      runId,
      channel,
      status,
      attempts: (existing?.attempts ?? 0) + (incrementAttempt ? 1 : 0),
      lastError: error ?? null,
      deliveredAt: status === "delivered" ? new Date().toISOString() : null,
    };
    this.db.insert(deliveryAttempts).values(values).onConflictDoUpdate({
      target: [deliveryAttempts.runId, deliveryAttempts.channel],
      set: { status: values.status, attempts: values.attempts, lastError: values.lastError, deliveredAt: values.deliveredAt },
    }).run();
    const saved = this.find(runId, channel);
    if (!saved) throw new Error("Delivery attempt was not persisted");
    return saved;
  }
}
