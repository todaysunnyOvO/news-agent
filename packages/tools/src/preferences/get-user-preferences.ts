import { Type } from "typebox";

import type { SubscriptionRepository } from "@news-agent/db";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";

interface GetUserPreferencesParams {
  userId: string;
}

export function createGetUserPreferencesTool(
  currentUserId: string,
  repository: SubscriptionRepository,
  logger: ToolAuditLogger,
): ToolDefinition<GetUserPreferencesParams, { userId: string }> {
  return {
    name: "get_user_preferences",
    label: "Get user preferences",
    description: "Read the current user's latest news subscription preferences.",
    parameters: Type.Object(
      { userId: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params) =>
      executeWithAudit(logger, "get_user_preferences", toolCallId, async () => {
        if (params.userId !== currentUserId) throw new Error("Cannot read another user's preferences");
        const subscription = repository.findByUserId(currentUserId);
        if (!subscription) throw new Error("User subscription preferences were not found");
        return {
          content: [{ type: "text", text: JSON.stringify(subscription) }],
          details: { userId: currentUserId },
        };
      }),
  };
}
