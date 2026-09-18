import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";

import { Type } from "typebox";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import { resolveWorkspacePath, type UserWorkspace } from "../workspace.js";

export interface WriteFileParams {
  path: string;
  content: string;
}

export interface WriteFileDetails {
  path: string;
  bytes: number;
}

const ALLOWED_EXTENSIONS = new Set([".md", ".json", ".txt"]);
const MAX_WRITE_BYTES = 1_000_000;

async function ensureSafeParent(workspace: UserWorkspace, filePath: string): Promise<void> {
  const targetParent = dirname(filePath);
  const relativeParent = relative(workspace.workspaceRoot, targetParent);
  let current = workspace.workspaceRoot;

  for (const segment of relativeParent.split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment);
    await mkdir(current).catch((error: unknown) => {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    });
    await resolveWorkspacePath(workspace, relative(workspace.workspaceRoot, current), {
      mustExist: true,
    });
  }
}

export function createWriteFileTool(
  workspace: UserWorkspace,
  logger: ToolAuditLogger,
): ToolDefinition<WriteFileParams, WriteFileDetails> {
  return {
    name: "write_file",
    label: "Write file",
    description: "Atomically write a Markdown, JSON, or text file inside the user's workspace.",
    parameters: Type.Object(
      {
        path: Type.String({ minLength: 1, description: "Workspace-relative output file path" }),
        content: Type.String({ maxLength: MAX_WRITE_BYTES }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params) =>
      executeWithAudit(logger, "write_file", toolCallId, async () => {
        if (!ALLOWED_EXTENSIONS.has(extname(params.path).toLowerCase())) {
          throw new Error("Only .md, .json, and .txt files may be written");
        }
        const bytes = Buffer.byteLength(params.content, "utf8");
        if (bytes > MAX_WRITE_BYTES) throw new Error("Content exceeds the 1 MB write limit");

        const target = await resolveWorkspacePath(workspace, params.path, {
          mustExist: false,
          rejectFinalSymlink: true,
        });
        await ensureSafeParent(workspace, target);
        const temporary = `${target}.${randomUUID()}.tmp`;

        try {
          await writeFile(temporary, params.content, { encoding: "utf8", flag: "wx" });
          await rename(temporary, target);
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw error;
        }

        return {
          content: [{ type: "text", text: `Wrote ${bytes} bytes to ${params.path}` }],
          details: { path: params.path, bytes },
        };
      }),
  };
}

