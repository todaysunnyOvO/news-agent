import type { AgentRunStatus } from "@news-agent/shared";

export type TodayViewState =
  | "generating"
  | "failed"
  | "ready"
  | "latest"
  | "skipped"
  | "empty";

export function resolveTodayViewState(input: {
  runStatus?: AgentRunStatus;
  hasSelectedBrief: boolean;
  selectedBriefIsToday: boolean;
  todaySkipped: boolean;
}): TodayViewState {
  if (input.runStatus === "queued" || input.runStatus === "running") return "generating";
  if (input.selectedBriefIsToday) return "ready";
  if (input.runStatus === "failed" || input.runStatus === "cancelled") return "failed";
  if (input.todaySkipped) return "skipped";
  if (input.hasSelectedBrief) return "latest";
  return "empty";
}
