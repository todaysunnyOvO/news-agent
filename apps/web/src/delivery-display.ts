import type { DeliveryChannel, DeliveryJobDetail } from "@news-agent/shared";

export type DeliveryViewState =
  | "configuration_required"
  | "onsite"
  | "awaiting"
  | "sending"
  | "succeeded"
  | "failed"
  | "cancelled";

export function deliveryChannelLabel(channel: DeliveryChannel | undefined): string {
  if (channel === "email") return "邮箱";
  if (channel === "webhook") return "Webhook";
  return "站内";
}

export function resolveDeliveryViewState(
  savedChannel: DeliveryChannel | undefined,
  deliveries: DeliveryJobDetail[],
): DeliveryViewState {
  if (!savedChannel) return "configuration_required";
  if (savedChannel === "web") return "onsite";
  const latest = deliveries.at(-1);
  if (!latest) return "awaiting";
  if (latest.status === "pending" || latest.status === "sending") return "sending";
  return latest.status;
}

export function deliveryFailureMessage(errorCode: string | null | undefined): string {
  if (!errorCode) return "外部服务暂时没有完成发送。";
  const normalized = errorCode.toLowerCase();
  if (normalized.includes("config") || normalized.includes("destination")) {
    return "接收渠道尚未正确配置，请检查设置后重试。";
  }
  if (normalized.includes("timeout")) return "外部服务响应超时，简报仍可在站内阅读。";
  if (normalized.includes("rate") || normalized.includes("limit")) {
    return "外部服务请求过于频繁，请稍后重试。";
  }
  if (normalized.includes("network") || normalized.includes("connect")) {
    return "暂时无法连接外部服务，请稍后重试。";
  }
  return "外部服务暂时没有完成发送，简报仍可在站内阅读。";
}

export function deliveryStateCopy(
  state: DeliveryViewState,
  channel: DeliveryChannel | undefined,
): { badge: string; title: string; description: string } {
  const channelLabel = deliveryChannelLabel(channel);
  switch (state) {
    case "configuration_required":
      return { badge: "尚未设置", title: "简报已保存在站内", description: "完成接收设置后，新简报可以自动发送到外部渠道。" };
    case "onsite":
      return { badge: "仅站内", title: "简报已保存在站内", description: "当前接收方式不会向外部发送消息。" };
    case "awaiting":
      return { badge: "等待发送", title: `等待发送到${channelLabel}`, description: "系统会按已保存的接收方式自动处理，无需日常手动投递。" };
    case "sending":
      return { badge: "发送中", title: `正在发送到${channelLabel}`, description: "简报已经保存在站内，外部发送正在后台处理。" };
    case "succeeded":
      return { badge: "已发送", title: `已发送到${channelLabel}`, description: "发送已完成；防重复规则会避免同一份简报被重复投递。" };
    case "failed":
      return { badge: "发送失败", title: `未能发送到${channelLabel}`, description: "简报仍可在站内阅读，你可以在这里重试。" };
    case "cancelled":
      return { badge: "已取消", title: "外部发送已取消", description: "简报仍保存在站内；如需发送，可以重新发起一次投递。" };
  }
}
