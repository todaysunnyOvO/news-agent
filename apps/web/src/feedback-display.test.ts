import { describe, expect, it } from "vitest";

import type { BriefItemFeedback } from "@news-agent/shared";

import {
  hasActiveNegativeFeedback,
  negativeFeedbackOptions,
  primaryItemActions,
} from "./feedback-display";

const feedback = (feedbackType: BriefItemFeedback["feedbackType"], active = true): BriefItemFeedback => ({
  id: `feedback-${feedbackType}`,
  userId: "user-1",
  briefItemId: "item-1",
  feedbackType,
  active,
  createdAt: "2026-09-19T00:00:00.000Z",
  updatedAt: "2026-09-19T00:00:00.000Z",
});

describe("progressive item feedback", () => {
  it("keeps exactly three primary actions visible", () => {
    expect(primaryItemActions).toEqual(["useful", "dislike", "save"]);
  });

  it("keeps negative reasons behind the dislike action", () => {
    expect(negativeFeedbackOptions).toEqual([
      { type: "not_interested", label: "不感兴趣" },
      { type: "already_known", label: "已经知道" },
      { type: "repetitive", label: "重复或没有新进展" },
    ]);
  });

  it("marks dislike active only for active negative feedback on the item", () => {
    expect(hasActiveNegativeFeedback([feedback("useful")], "item-1")).toBe(false);
    expect(hasActiveNegativeFeedback([feedback("not_interested", false)], "item-1")).toBe(false);
    expect(hasActiveNegativeFeedback([feedback("repetitive")], "item-1")).toBe(true);
    expect(hasActiveNegativeFeedback([feedback("already_known")], "item-2")).toBe(false);
  });
});
