import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import type {
  DeliveryChannel,
  Subscription,
  UpsertSubscriptionInput,
} from "@news-agent/shared";

import type { NewsDatabase } from "../database.js";
import { subscriptions } from "../schema.js";

type SubscriptionRow = typeof subscriptions.$inferSelect;

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    topics: parseStringArray(row.topicsJson),
    keywords: parseStringArray(row.keywordsJson),
    excludedKeywords: parseStringArray(row.excludedKeywordsJson),
    languages: parseStringArray(row.languagesJson),
    sourceIds: parseStringArray(row.sourceIdsJson),
    maxItems: row.maxItems,
    scheduleCron: row.scheduleCron,
    timezone: row.timezone,
    deliveryChannel: row.deliveryChannel as DeliveryChannel,
    enabled: row.enabled,
    pausedUntil: row.pausedUntil,
    skipDates: parseStringArray(row.skipDatesJson),
    personalizationEnabled: row.personalizationEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SubscriptionRepository {
  public constructor(private readonly db: NewsDatabase) {}

  public findByUserId(userId: string): Subscription | undefined {
    const row = this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .get();

    return row ? toSubscription(row) : undefined;
  }

  public listEnabled(): Subscription[] {
    return this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.enabled, true))
      .all()
      .map(toSubscription);
  }

  public upsert(userId: string, input: UpsertSubscriptionInput): Subscription {
    const existing = this.db
      .select({
        id: subscriptions.id,
        createdAt: subscriptions.createdAt,
        personalizationEnabled: subscriptions.personalizationEnabled,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .get();
    const now = new Date().toISOString();
    const values = {
      id: existing?.id ?? randomUUID(),
      userId,
      topicsJson: JSON.stringify(input.topics),
      keywordsJson: JSON.stringify(input.keywords),
      excludedKeywordsJson: JSON.stringify(input.excludedKeywords),
      languagesJson: JSON.stringify(input.languages),
      sourceIdsJson: JSON.stringify(input.sourceIds),
      maxItems: input.maxItems,
      scheduleCron: input.scheduleCron,
      timezone: input.timezone,
      deliveryChannel: input.deliveryChannel,
      enabled: input.enabled,
      pausedUntil: input.pausedUntil ?? null,
      skipDatesJson: JSON.stringify(input.skipDates ?? []),
      personalizationEnabled: input.personalizationEnabled ?? existing?.personalizationEnabled ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db
      .insert(subscriptions)
      .values(values)
      .onConflictDoUpdate({
        target: subscriptions.userId,
        set: {
          topicsJson: values.topicsJson,
          keywordsJson: values.keywordsJson,
          excludedKeywordsJson: values.excludedKeywordsJson,
          languagesJson: values.languagesJson,
          sourceIdsJson: values.sourceIdsJson,
          maxItems: values.maxItems,
          scheduleCron: values.scheduleCron,
          timezone: values.timezone,
          deliveryChannel: values.deliveryChannel,
          enabled: values.enabled,
          pausedUntil: values.pausedUntil,
          skipDatesJson: values.skipDatesJson,
          personalizationEnabled: values.personalizationEnabled,
          updatedAt: values.updatedAt,
        },
      })
      .run();

    const saved = this.findByUserId(userId);
    if (!saved) {
      throw new Error("Subscription was not persisted");
    }
    return saved;
  }
}
