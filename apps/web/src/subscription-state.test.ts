import { describe, expect, it } from "vitest";

import type { Subscription } from "@news-agent/shared";

import { hasUnsavedSubscriptionChanges, toSubscriptionDraft } from "./subscription-state";

const savedSubscription: Subscription = {
  id: "subscription-1",
  userId: "user-1",
  topics: ["AI"],
  keywords: ["Agent"],
  excludedKeywords: [],
  languages: ["zh-CN"],
  sourceIds: [],
  maxItems: 5,
  scheduleCron: "0 8 * * *",
  timezone: "Asia/Shanghai",
  deliveryChannel: "web",
  enabled: true,
  pausedUntil: null,
  skipDates: [],
  personalizationEnabled: true,
  createdAt: "2026-09-18T00:00:00.000Z",
  updatedAt: "2026-09-18T00:00:00.000Z",
};

describe("subscription editing state", () => {
  it("treats a freshly loaded subscription as saved", () => {
    expect(hasUnsavedSubscriptionChanges(toSubscriptionDraft(savedSubscription), savedSubscription)).toBe(false);
  });

  it("detects a delivery channel changed only in the draft", () => {
    const draft = { ...toSubscriptionDraft(savedSubscription), deliveryChannel: "email" as const };
    expect(hasUnsavedSubscriptionChanges(draft, savedSubscription)).toBe(true);
    expect(savedSubscription.deliveryChannel).toBe("web");
  });

  it("treats a missing persisted subscription as unsaved", () => {
    expect(hasUnsavedSubscriptionChanges(toSubscriptionDraft(savedSubscription), undefined)).toBe(true);
  });

  it("copies array fields so draft edits cannot mutate the saved snapshot", () => {
    const draft = toSubscriptionDraft(savedSubscription);
    draft.topics.push("Robotics");
    expect(savedSubscription.topics).toEqual(["AI"]);
  });
});
