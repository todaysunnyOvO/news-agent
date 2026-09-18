import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type NewsAgentEvent =
  | { type: "run_started"; runId: string; timestamp: string }
  | { type: "agent_text_delta"; runId: string; timestamp: string; delta: string }
  | { type: "tool_started"; runId: string; timestamp: string; toolCallId: string; toolName: string }
  | { type: "tool_finished"; runId: string; timestamp: string; toolCallId: string; toolName: string; success: boolean; durationMs: number }
  | { type: "brief_saved"; runId: string; timestamp: string; briefId: string }
  | { type: "run_failed"; runId: string; timestamp: string; error: string }
  | { type: "run_finished"; runId: string; timestamp: string; status: "succeeded" | "failed" | "cancelled"; toolCallCount: number; turnCount: number };

export type NewsAgentEventListener = (event: NewsAgentEvent) => void;

export interface EventMapperState {
  toolStartedAt: Map<string, number>;
}

function now(): string {
  return new Date().toISOString();
}

export function mapSessionEvent(
  runId: string,
  event: AgentSessionEvent,
  state: EventMapperState,
): NewsAgentEvent[] {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    return [{ type: "agent_text_delta", runId, timestamp: now(), delta: event.assistantMessageEvent.delta }];
  }
  if (event.type === "tool_execution_start") {
    state.toolStartedAt.set(event.toolCallId, performance.now());
    return [{
      type: "tool_started",
      runId,
      timestamp: now(),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    }];
  }
  if (event.type === "tool_execution_end") {
    const startedAt = state.toolStartedAt.get(event.toolCallId) ?? performance.now();
    state.toolStartedAt.delete(event.toolCallId);
    const mapped: NewsAgentEvent[] = [{
      type: "tool_finished",
      runId,
      timestamp: now(),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      success: !event.isError,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    }];
    if (event.toolName === "save_brief" && !event.isError) {
      const details = (event.result as { details?: { briefId?: unknown } }).details;
      if (typeof details?.briefId === "string") {
        mapped.push({ type: "brief_saved", runId, timestamp: now(), briefId: details.briefId });
      }
    }
    return mapped;
  }
  return [];
}
