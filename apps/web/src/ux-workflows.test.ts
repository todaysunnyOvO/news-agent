import { describe, expect, it } from "vitest";

import type { BriefItemFeedback, DeliveryJobDetail, Subscription } from "@news-agent/shared";

import { deliveryFailureMessage, deliveryStateCopy, resolveDeliveryViewState } from "./delivery-display";
import { hasActiveNegativeFeedback, negativeFeedbackOptions, primaryItemActions } from "./feedback-display";
import { primaryNavigation } from "./navigation";
import { onboardingStepCount, onboardingSteps } from "./onboarding";
import { hasUnsavedSubscriptionChanges, toSubscriptionDraft } from "./subscription-state";
import { resolveTodayViewState } from "./today-state";

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
  deliveryChannel: "email",
  enabled: true,
  pausedUntil: null,
  skipDates: [],
  personalizationEnabled: true,
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
};

function failedDelivery(): DeliveryJobDetail {
  return {
    id: "delivery-1",
    briefId: "brief-1",
    runId: "run-1",
    userId: "user-1",
    channel: "email",
    destinationHash: "hash",
    idempotencyKey: "brief:brief-1:email",
    status: "failed",
    attemptCount: 3,
    nextAttemptAt: null,
    deliveredAt: null,
    lastError: "delivery_timeout",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    attempts: [],
  };
}

describe("UX R1 task workflows", () => {
  it("keeps first-use setup to three steps and treats it as unsaved until persisted", () => {
    expect(onboardingStepCount).toBe(3);
    expect(onboardingSteps.map((step) => step.id)).toEqual(["content", "schedule", "delivery"]);
    expect(hasUnsavedSubscriptionChanges(toSubscriptionDraft(savedSubscription), undefined)).toBe(true);
  });

  it("opens daily use around today with only three primary destinations", () => {
    expect(primaryNavigation.map((item) => item.id)).toEqual(["today", "library", "settings"]);
    expect(resolveTodayViewState({ hasSelectedBrief: true, selectedBriefIsToday: true, todaySkipped: false })).toBe("ready");
  });

  it("keeps item feedback progressive instead of showing every reason", () => {
    const negativeFeedback: BriefItemFeedback = {
      id: "feedback-1",
      userId: "user-1",
      briefItemId: "item-1",
      feedbackType: "not_interested",
      active: true,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    expect(primaryItemActions).toHaveLength(3);
    expect(negativeFeedbackOptions).toHaveLength(3);
    expect(hasActiveNegativeFeedback([negativeFeedback], "item-1")).toBe(true);
  });

  it("keeps a failed external delivery recoverable without losing onsite reading", () => {
    const job = failedDelivery();
    const state = resolveDeliveryViewState(savedSubscription.deliveryChannel, [job]);
    expect(state).toBe("failed");
    expect(deliveryStateCopy(state, savedSubscription.deliveryChannel).description).toContain("站内阅读");
    expect(deliveryFailureMessage(job.lastError)).toContain("响应超时");
  });
});
