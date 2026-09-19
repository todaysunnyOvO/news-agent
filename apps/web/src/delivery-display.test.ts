import { describe, expect, it } from "vitest";

import type { DeliveryJobDetail, DeliveryJobStatus } from "@news-agent/shared";

import {
  deliveryChannelLabel,
  deliveryFailureMessage,
  deliveryStateCopy,
  resolveDeliveryViewState,
} from "./delivery-display";

function delivery(status: DeliveryJobStatus): DeliveryJobDetail {
  return {
    id: `delivery-${status}`,
    briefId: "brief-1",
    runId: "run-1",
    userId: "user-1",
    channel: "email",
    destinationHash: "hash",
    idempotencyKey: "brief:brief-1:email",
    status,
    attemptCount: 1,
    nextAttemptAt: null,
    deliveredAt: status === "succeeded" ? "2026-09-19T00:00:00.000Z" : null,
    lastError: status === "failed" ? "delivery_timeout" : null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    attempts: [],
  };
}

describe("delivery result presentation", () => {
  it("covers configuration, onsite and awaiting external delivery", () => {
    expect(resolveDeliveryViewState(undefined, [])).toBe("configuration_required");
    expect(resolveDeliveryViewState("web", [delivery("failed")])).toBe("onsite");
    expect(resolveDeliveryViewState("email", [])).toBe("awaiting");
    expect(resolveDeliveryViewState("webhook", [])).toBe("awaiting");
  });

  it("maps external job lifecycle to user-facing states", () => {
    expect(resolveDeliveryViewState("email", [delivery("pending")])).toBe("sending");
    expect(resolveDeliveryViewState("email", [delivery("sending")])).toBe("sending");
    expect(resolveDeliveryViewState("email", [delivery("succeeded")])).toBe("succeeded");
    expect(resolveDeliveryViewState("webhook", [delivery("failed")])).toBe("failed");
    expect(resolveDeliveryViewState("webhook", [delivery("cancelled")])).toBe("cancelled");
  });

  it("uses user language and does not expose raw provider errors", () => {
    expect(deliveryChannelLabel("email")).toBe("邮箱");
    expect(deliveryChannelLabel("webhook")).toBe("Webhook");
    expect(deliveryFailureMessage("delivery_timeout")).toContain("响应超时");
    expect(deliveryFailureMessage("secret_provider_failure")).not.toContain("secret_provider_failure");
    expect(deliveryStateCopy("succeeded", "email").title).toBe("已发送到邮箱");
    expect(deliveryStateCopy("failed", "webhook").description).toContain("站内阅读");
  });
});
