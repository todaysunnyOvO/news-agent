import { readdir } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Type } from "typebox";

import { runProcess, type ProcessResult } from "../process.js";
import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import { resolveWorkspacePath, type UserWorkspace } from "../workspace.js";

export interface BashParams {
  command: string;
}

export interface BashDetails {
  executable: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
}

const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 5_000;
const SHELL_META_PATTERN = /[\r\n;&|><`]/;
const ALLOWED_RG_FLAGS = new Set([
  "-n",
  "-i",
  "-F",
  "--line-number",
  "--ignore-case",
  "--fixed-strings",
]);

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|[^\s]+/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[0]).replaceAll('\\"', '"'));
  }
  return tokens;
}

function builtInResult(stdout: string, startedAt: number): ProcessResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: Math.round(performance.now() - startedAt),
    truncated: false,
  };
}

async function executeAllowedCommand(
  workspace: UserWorkspace,
  command: string,
  signal?: AbortSignal,
): Promise<{ executable: string; result: ProcessResult }> {
  if (SHELL_META_PATTERN.test(command)) {
    throw new Error("Shell operators, redirection, and multi-line commands are not allowed");
  }

  const tokens = tokenize(command.trim());
  const executable = tokens.shift();
  if (!executable) throw new Error("Command cannot be empty");
  const startedAt = performance.now();

  if (executable === "pwd") {
    if (tokens.length > 0) throw new Error("pwd does not accept arguments");
    return { executable, result: builtInResult(".\n", startedAt) };
  }

  if (executable === "ls" || executable === "dir") {
    if (tokens.length > 1) throw new Error(`${executable} accepts at most one path`);
    const directory = await resolveWorkspacePath(workspace, tokens[0] ?? ".", { mustExist: true });
    const entries = await readdir(directory);
    const output = `${entries.slice(0, 200).join("\n")}${entries.length > 0 ? "\n" : ""}`;
    return { executable, result: builtInResult(output, startedAt) };
  }

  if (executable === "node") {
    if (tokens.length !== 1 || !["--version", "-v"].includes(tokens[0] ?? "")) {
      throw new Error("Only 'node --version' is allowed");
    }
    return {
      executable,
      result: await runProcess(process.execPath, tokens, {
        cwd: workspace.workspaceRoot,
        timeoutMs: TIMEOUT_MS,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        ...(signal ? { signal } : {}),
      }),
    };
  }

  if (executable === "rg") {
    const args: string[] = [];
    const positional: string[] = [];
    for (const token of tokens) {
      if (token.startsWith("-")) {
        if (!ALLOWED_RG_FLAGS.has(token)) throw new Error(`rg option is not allowed: ${token}`);
        args.push(token);
      } else {
        positional.push(token);
      }
    }
    if (positional.length < 1 || positional.length > 2) {
      throw new Error("rg requires a pattern and accepts at most one workspace-relative path");
    }
    args.push(positional[0] ?? "");
    if (positional[1]) {
      if (isAbsolute(positional[1])) throw new Error("Absolute search paths are not allowed");
      const searchPath = await resolveWorkspacePath(workspace, positional[1], { mustExist: true });
      args.push(searchPath);
    }

    const result = await runProcess("rg", args, {
      cwd: workspace.workspaceRoot,
      timeoutMs: TIMEOUT_MS,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      ...(signal ? { signal } : {}),
    });
    return { executable, result };
  }

  throw new Error(`Command is not allowlisted: ${executable}`);
}

export function createBashTool(
  workspace: UserWorkspace,
  logger: ToolAuditLogger,
): ToolDefinition<BashParams, BashDetails> {
  return {
    name: "bash",
    label: "Run safe command",
    description: "Run one allowlisted command in the user's workspace. No shell operators or redirection.",
    parameters: Type.Object(
      {
        command: Type.String({ minLength: 1, maxLength: 2_000 }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) =>
      executeWithAudit(logger, "bash", toolCallId, async () => {
        const { executable, result } = await executeAllowedCommand(workspace, params.command, signal);
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          throw new Error(result.stderr || `Command exited with code ${result.exitCode}`);
        }
        const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return {
          content: [{ type: "text", text: combinedOutput || "Command completed with no output" }],
          details: {
            executable,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            truncated: result.truncated,
          },
        };
      }),
  };
}
