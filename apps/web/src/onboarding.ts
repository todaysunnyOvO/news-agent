export const onboardingSteps = [
  { id: "content", title: "选择关注内容" },
  { id: "schedule", title: "安排接收时间" },
  { id: "delivery", title: "选择接收方式" },
] as const;

export const onboardingStepCount = onboardingSteps.length;

export function clampOnboardingStep(step: number): number {
  return Math.min(onboardingStepCount, Math.max(1, step));
}
