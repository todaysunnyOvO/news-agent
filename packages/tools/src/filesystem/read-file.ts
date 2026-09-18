import { readFile, stat } from "node:fs/promises";

import { Type } from "typebox";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import { resolveWorkspacePath, type UserWorkspace } from "../workspace.js";

export interface ReadFileParams {
  path: string;
}

export interface ReadFileDetails {
  path: string;
  bytes: number;
  returnedCharacters: number;
  truncated: boolean;
}

const MAX_FILE_BYTES = 1_000_000;
const MAX_RETURNED_CHARACTERS = 12_000;

export function createReadFileTool(
  workspace: UserWorkspace,
  logger: ToolAuditLogger,
): ToolDefinition<ReadFileParams, ReadFileDetails> {
  return {
    name: "read_file",
    label: "Read file",
    description: "Read a UTF-8 text file from the current user's isolated workspace.",
    parameters: Type.Object(
      {
        path: Type.String({ minLength: 1, description: "Workspace-relative text file path" }),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params) =>
      executeWithAudit(logger, "read_file", toolCallId, async () => {
        const filePath = await resolveWorkspacePath(workspace, params.path, { mustExist: true });
        const fileStats = await stat(filePath);
        if (!fileStats.isFile()) throw new Error("Path is not a regular file");
        if (fileStats.size > MAX_FILE_BYTES) throw new Error("File exceeds the 1 MB read limit");

        const fullContent = await readFile(filePath, "utf8");
        const truncated = fullContent.length > MAX_RETURNED_CHARACTERS;
        const content = truncated
          ? `${fullContent.slice(0, MAX_RETURNED_CHARACTERS)}\n\n[Content truncated]`
          : fullContent;

        return {
          content: [{ type: "text", text: content }],
          details: {
            path: params.path,
            bytes: fileStats.size,
            returnedCharacters: content.length,
            truncated,
          },
        };
      }),
  };
}

