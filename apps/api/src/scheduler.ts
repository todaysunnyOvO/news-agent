import type { Subscription } from "@news-agent/shared";

import type { AppRepositories, AgentRunController, RunEventStore } from "./types.js";

function localParts(date: Date, timezone: string): { date: string; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  const localDate = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date: localDate,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: new Date(`${localDate}T12:00:00.000Z`).getUTCDay(),
  };
}

function dayMatches(expression: string, weekday: number): boolean {
  if (expression === "*") return true;
  if (expression === "1-5") return weekday >= 1 && weekday <= 5;
  return expression.split(",").some((value) => Number(value) === weekday);
}

export function isSubscriptionDue(subscription: Subscription, now: Date, compensationMinutes = 240): { due: boolean; localDate: string } {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = subscription.scheduleCron.trim().split(/\s+/);
  const local = localParts(now, subscription.timezone);
  if (
    dayOfMonth !== "*" ||
    month !== "*" ||
    !dayOfWeek ||
    !dayMatches(dayOfWeek, local.weekday) ||
    subscription.skipDates.includes(local.date) ||
    (subscription.pausedUntil !== null && subscription.pausedUntil >= local.date)
  ) return { due: false, localDate: local.date };
  const scheduledMinute = Number(hour) * 60 + Number(minute);
  const currentMinute = local.hour * 60 + local.minute;
  const delay = currentMinute - scheduledMinute;
  return { due: delay >= 0 && delay <= compensationMinutes, localDate: local.date };
}

export class NewsScheduler {
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly repositories: AppRepositories,
    private readonly controller: AgentRunController,
    private readonly events: RunEventStore,
  ) {}

  public async tick(now = new Date()): Promise<void> {
    for (const subscription of this.repositories.subscriptions.listEnabled()) {
      const { due, localDate } = isSubscriptionDue(subscription, now);
      if (!due) continue;
      const idempotencyKey = `${subscription.userId}:${localDate}`;
      if (this.repositories.runs.hasActiveOrSucceededIdempotencyKey(idempotencyKey)) continue;
      try {
        const started = this.controller.start({ userId: subscription.userId, trigger: "scheduled", idempotencyKey, onEvent: (event) => this.events.publish(event) });
        void started.completion;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE constraint")) throw error;
      }
    }
  }

  public start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
