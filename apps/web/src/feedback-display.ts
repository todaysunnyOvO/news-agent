import type { BriefItemFeedback, BriefItemFeedbackType } from "@news-agent/shared";

export const primaryItemActions = ["useful", "dislike", "save"] as const;

export const negativeFeedbackOptions: Array<{
  type: Exclude<BriefItemFeedbackType, "useful">;
  label: string;
}> = [
  { type: "not_interested", label: "不感兴趣" },
  { type: "already_known", label: "已经知道" },
  { type: "repetitive", label: "重复或没有新进展" },
];

export function hasActiveNegativeFeedback(
  feedback: BriefItemFeedback[],
  itemId: string,
): boolean {
  return feedback.some((item) =>
    item.briefItemId === itemId
    && item.active
    && item.feedbackType !== "useful",
  );
}
