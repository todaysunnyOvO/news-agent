import { describe, expect, it } from "vitest";

import { resolveTodayViewState } from "./today-state";

describe("today view state", () => {
  it("prioritizes an active generation", () => {
    expect(resolveTodayViewState({
      runStatus: "running",
      hasSelectedBrief: true,
      selectedBriefIsToday: true,
      todaySkipped: false,
    })).toBe("generating");
  });

  it("shows today's brief after generation succeeds", () => {
    expect(resolveTodayViewState({
      runStatus: "succeeded",
      hasSelectedBrief: true,
      selectedBriefIsToday: true,
      todaySkipped: false,
    })).toBe("ready");
  });

  it("distinguishes the latest older brief from today's brief", () => {
    expect(resolveTodayViewState({
      hasSelectedBrief: true,
      selectedBriefIsToday: false,
      todaySkipped: false,
    })).toBe("latest");
  });

  it("shows skipped and empty states without a brief", () => {
    expect(resolveTodayViewState({
      hasSelectedBrief: false,
      selectedBriefIsToday: false,
      todaySkipped: true,
    })).toBe("skipped");
    expect(resolveTodayViewState({
      hasSelectedBrief: false,
      selectedBriefIsToday: false,
      todaySkipped: false,
    })).toBe("empty");
  });

  it("keeps a failed run distinct from an older brief", () => {
    expect(resolveTodayViewState({
      runStatus: "failed",
      hasSelectedBrief: true,
      selectedBriefIsToday: false,
      todaySkipped: false,
    })).toBe("failed");
  });
});
