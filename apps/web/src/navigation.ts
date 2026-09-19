export const primaryNavigation = [
  { id: "today", label: "今日" },
  { id: "library", label: "收藏与追踪" },
  { id: "settings", label: "设置" },
] as const;

export type PrimaryNavigationId = (typeof primaryNavigation)[number]["id"];

export function isSettingsArea(view: string): boolean {
  return ["settings", "personalization", "quality", "run"].includes(view);
}
