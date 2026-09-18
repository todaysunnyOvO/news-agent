import type { TSchema } from "typebox";

export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResult<TDetails = Record<string, unknown>> {
  content: ToolTextContent[];
  details: TDetails;
}

export interface ToolDefinition<TParams, TDetails = Record<string, unknown>> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  executionMode?: "parallel" | "sequential";
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: (result: ToolResult<TDetails>) => void,
  ) => Promise<ToolResult<TDetails>>;
}

export type ToolAuditStatus = "started" | "succeeded" | "failed";

export interface ToolAuditEvent {
  toolCallId: string;
  toolName: string;
  status: ToolAuditStatus;
  timestamp: string;
  durationMs?: number;
  error?: string;
}

export interface ToolAuditLogger {
  log(event: ToolAuditEvent): void | Promise<void>;
}

export const noopToolAuditLogger: ToolAuditLogger = {
  log: () => undefined,
};

export async function executeWithAudit<T>(
  logger: ToolAuditLogger,
  toolName: string,
  toolCallId: string,
  execute: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  await logger.log({
    toolCallId,
    toolName,
    status: "started",
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await execute();
    await logger.log({
      toolCallId,
      toolName,
      status: "succeeded",
      timestamp: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    await logger.log({
      toolCallId,
      toolName,
      status: "failed",
      timestamp: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Unknown tool error",
    });
    throw error;
  }
}

