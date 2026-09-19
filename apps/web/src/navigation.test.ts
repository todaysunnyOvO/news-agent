import { describe, expect, it } from "vitest";

import { isSettingsArea, primaryNavigation } from "./navigation";

describe("primary experience navigation", () => {
  it("keeps only the three user-facing destinations at the first level", () => {
    expect(primaryNavigation).toEqual([
      { id: "today", label: "今日" },
      { id: "library", label: "收藏与追踪" },
      { id: "settings", label: "设置" },
    ]);
  });

  it("treats diagnostics and personalization as part of settings", () => {
    expect(isSettingsArea("settings")).toBe(true);
    expect(isSettingsArea("personalization")).toBe(true);
    expect(isSettingsArea("quality")).toBe(true);
    expect(isSettingsArea("run")).toBe(true);
    expect(isSettingsArea("today")).toBe(false);
  });
});
