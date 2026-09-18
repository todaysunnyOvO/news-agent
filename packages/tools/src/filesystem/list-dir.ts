import { readdir } from "node:fs/promises";

import { Type } from "typebox";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import { resolveWorkspacePath, type UserWorkspace } from "../workspace.js";

export interface ListDirParams {
  path: string;
}

export interface ListDirDetails {
  path: string;
  count: number;
  truncated: boolean;
}

const MAX_ENTRIES = 200;

export function createListDirTool(
  workspace: UserWorkspace,
  logger: ToolAuditLogger,
): ToolDefinition<ListDirParams, ListDirDetails> {
  return {
    name: "list_dir",
    label: "List directory",
    description: "List files and subdirectories inside the current user's isolated workspace.",
    parameters: Type.Object(
      {
        path: Type.String({ description: "Workspace-relative directory path" }),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params) =>
      executeWithAudit(logger, "list_dir", toolCallId, async () => {
        const directory = await resolveWorkspacePath(workspace, params.path, { mustExist: true });
        const allEntries = await readdir(directory, { withFileTypes: true });
        const entries = allEntries
          .slice(0, MAX_ENTRIES)
          .map((entry) => ({
            name: entry.name,
            type: entry.isDirectory()
              ? "directory"
              : entry.isFile()
                ? "file"
                : entry.isSymbolicLink()
                  ? "symlink"
                  : "other",
          }));

        return {
          content: [{ type: "text", text: JSON.stringify(entries) }],
          details: {
            path: params.path,
            count: entries.length,
            truncated: allEntries.length > MAX_ENTRIES,
          },
        };
      }),
  };
}

