import type { Subscription, UpsertSubscriptionInput } from "@news-agent/shared";

const subscriptionFields = [
  "topics",
  "keywords",
  "excludedKeywords",
  "languages",
  "sourceIds",
  "maxItems",
  "scheduleCron",
  "timezone",
  "deliveryChannel",
  "enabled",
  "pausedUntil",
  "skipDates",
  "personalizationEnabled",
] as const;

export function toSubscriptionDraft(subscription: Subscription): UpsertSubscriptionInput {
  return {
    topics: [...subscription.topics],
    keywords: [...subscription.keywords],
    excludedKeywords: [...subscription.excludedKeywords],
    languages: [...subscription.languages],
    sourceIds: [...subscription.sourceIds],
    maxItems: subscription.maxItems,
    scheduleCron: subscription.scheduleCron,
    timezone: subscription.timezone,
    deliveryChannel: subscription.deliveryChannel,
    enabled: subscription.enabled,
    pausedUntil: subscription.pausedUntil,
    skipDates: [...subscription.skipDates],
    personalizationEnabled: subscription.personalizationEnabled,
  };
}

export function hasUnsavedSubscriptionChanges(
  draft: UpsertSubscriptionInput,
  saved: Subscription | undefined,
): boolean {
  if (!saved) return true;
  const normalizedDraft = {
    ...draft,
    pausedUntil: draft.pausedUntil ?? null,
    skipDates: draft.skipDates ?? [],
    personalizationEnabled: draft.personalizationEnabled ?? true,
  };
  return subscriptionFields.some((field) =>
    JSON.stringify(normalizedDraft[field]) !== JSON.stringify(saved[field]),
  );
}
