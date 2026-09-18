import { randomUUID } from "node:crypto";

import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

import type {
  InferredPreference,
  InferredPreferenceKind,
  InferredPreferenceStatus,
} from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { inferredPreferences } from "../schema.js";

export interface PreferenceSuggestion {
  kind: InferredPreferenceKind;
  value: string;
  weight: number;
  confidence: number;
  evidenceIds: string[];
  lastReinforcedAt: string;
  expiresAt: string;
}

function toPreference(row: typeof inferredPreferences.$inferSelect): InferredPreference {
  return {
    ...row,
    kind: row.kind as InferredPreferenceKind,
    status: row.status as InferredPreferenceStatus,
    weight: row.weight / 1000,
    confidence: row.confidence / 1000,
    evidenceIds: JSON.parse(row.evidenceJson) as string[],
  };
}

export class InferredPreferenceRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public listByUserId(userId: string, now = new Date()): InferredPreference[] {
    return this.db
      .select()
      .from(inferredPreferences)
      .where(and(
        eq(inferredPreferences.userId, userId),
        or(isNull(inferredPreferences.expiresAt), gt(inferredPreferences.expiresAt, now.toISOString())),
      ))
      .orderBy(desc(inferredPreferences.confidence), desc(inferredPreferences.updatedAt))
      .all()
      .map(toPreference);
  }

  public findById(id: string): InferredPreference | undefined {
    const row = this.db.select().from(inferredPreferences).where(eq(inferredPreferences.id, id)).get();
    return row ? toPreference(row) : undefined;
  }

  public upsertSuggestion(userId: string, suggestion: PreferenceSuggestion): InferredPreference {
    const existing = this.db
      .select()
      .from(inferredPreferences)
      .where(and(
        eq(inferredPreferences.userId, userId),
        eq(inferredPreferences.kind, suggestion.kind),
        eq(inferredPreferences.value, suggestion.value),
      ))
      .get();
    const now = new Date().toISOString();
    const values = {
      id: existing?.id ?? randomUUID(),
      userId,
      kind: suggestion.kind,
      value: suggestion.value,
      weight: existing?.status === "accepted" ? existing.weight : Math.round(suggestion.weight * 1000),
      confidence: Math.round(suggestion.confidence * 1000),
      status: existing?.status ?? "suggested",
      evidenceCount: suggestion.evidenceIds.length,
      evidenceJson: JSON.stringify(suggestion.evidenceIds.slice(-50)),
      lastReinforcedAt: suggestion.lastReinforcedAt,
      expiresAt: suggestion.expiresAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db.insert(inferredPreferences).values(values).onConflictDoUpdate({
      target: [inferredPreferences.userId, inferredPreferences.kind, inferredPreferences.value],
      set: {
        weight: values.weight,
        confidence: values.confidence,
        status: values.status,
        evidenceCount: values.evidenceCount,
        evidenceJson: values.evidenceJson,
        lastReinforcedAt: values.lastReinforcedAt,
        expiresAt: values.expiresAt,
        updatedAt: now,
      },
    }).run();
    return this.findById(values.id)!;
  }

  public update(
    userId: string,
    id: string,
    input: { status?: InferredPreferenceStatus; weight?: number },
  ): InferredPreference | undefined {
    const existing = this.findById(id);
    if (!existing || existing.userId !== userId) return undefined;
    this.db.update(inferredPreferences).set({
      status: input.status ?? existing.status,
      weight: Math.round((input.weight ?? existing.weight) * 1000),
      updatedAt: new Date().toISOString(),
    }).where(eq(inferredPreferences.id, id)).run();
    return this.findById(id);
  }

  public delete(userId: string, id: string): boolean {
    return this.db.delete(inferredPreferences).where(and(eq(inferredPreferences.id, id), eq(inferredPreferences.userId, userId))).run().changes > 0;
  }
}
