import type { ToolDefinition as PiToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@news-agent/tools";

export function adaptTools(tools: ToolDefinition<unknown, unknown>[]): PiToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    execute: async (toolCallId, params, signal, onUpdate) =>
      tool.execute(
        toolCallId,
        params,
        signal,
        onUpdate ? (result) => onUpdate(result) : undefined,
      ),
  })) as PiToolDefinition[];
}
