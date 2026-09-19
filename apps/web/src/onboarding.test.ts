import { describe, expect, it } from "vitest";

import { clampOnboardingStep, onboardingStepCount, onboardingSteps } from "./onboarding";

describe("first-use onboarding", () => {
  it("contains exactly the three planned user steps", () => {
    expect(onboardingSteps).toEqual([
      { id: "content", title: "选择关注内容" },
      { id: "schedule", title: "安排接收时间" },
      { id: "delivery", title: "选择接收方式" },
    ]);
    expect(onboardingStepCount).toBe(3);
  });

  it("keeps navigation within the available steps", () => {
    expect(clampOnboardingStep(0)).toBe(1);
    expect(clampOnboardingStep(2)).toBe(2);
    expect(clampOnboardingStep(4)).toBe(3);
  });
});
