import { lstat, readFile, readdir } from "node:fs/promises";
import { extname, relative } from "node:path";

import { Type } from "typebox";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import { resolveWorkspacePath, type UserWorkspace } from "../workspace.js";

export interface SearchContentParams {
  keyword: string;
  dir: string;
}

export interface SearchContentDetails {
  directory: string;
  filesScanned: number;
  matchCount: number;
  truncated: boolean;
}

interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

const SEARCHABLE_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const MAX_FILES = 200;
const MAX_RESULTS = 50;
const MAX_FILE_BYTES = 1_000_000;

export function createSearchContentTool(
  workspace: UserWorkspace,
  logger: ToolAuditLogger,
): ToolDefinition<SearchContentParams, SearchContentDetails> {
  return {
    name: "search_content",
    label: "Search content",
    description: "Search UTF-8 text files for a keyword inside a workspace directory.",
    parameters: Type.Object(
      {
        keyword: Type.String({ minLength: 1, maxLength: 200 }),
        dir: Type.String({ description: "Workspace-relative directory path" }),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params, signal) =>
      executeWithAudit(logger, "search_content", toolCallId, async () => {
        const root = await resolveWorkspacePath(workspace, params.dir, { mustExist: true });
        const rootStats = await lstat(root);
        if (!rootStats.isDirectory()) throw new Error("Search path is not a directory");

        const pending = [root];
        const matches: SearchMatch[] = [];
        let filesScanned = 0;
        let truncated = false;
        const needle = params.keyword.toLocaleLowerCase();

        while (pending.length > 0 && matches.length < MAX_RESULTS) {
          if (signal?.aborted) throw signal.reason ?? new Error("Search aborted");
          const current = pending.pop();
          if (!current) break;

          for (const entry of await readdir(current, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const entryPath = `${current}/${entry.name}`;
            if (entry.isDirectory()) {
              pending.push(entryPath);
              continue;
            }
            if (!entry.isFile() || !SEARCHABLE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
            if (filesScanned >= MAX_FILES) {
              truncated = true;
              break;
            }

            const stats = await lstat(entryPath);
            filesScanned += 1;
            if (stats.size > MAX_FILE_BYTES) continue;

            const lines = (await readFile(entryPath, "utf8")).split(/\r?\n/);
            for (const [index, line] of lines.entries()) {
              if (!line.toLocaleLowerCase().includes(needle)) continue;
              matches.push({
                path: relative(workspace.workspaceRoot, entryPath).replaceAll("\\", "/"),
                line: index + 1,
                text: line.slice(0, 500),
              });
              if (matches.length >= MAX_RESULTS) {
                truncated = true;
                break;
              }
            }
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(matches) }],
          details: {
            directory: params.dir,
            filesScanned,
            matchCount: matches.length,
            truncated,
          },
        };
      }),
  };
}

