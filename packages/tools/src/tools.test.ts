import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createListDirTool } from "./filesystem/list-dir.js";
import { createReadFileTool } from "./filesystem/read-file.js";
import { createSearchContentTool } from "./filesystem/search-content.js";
import { createWriteFileTool } from "./filesystem/write-file.js";
import { runProcess } from "./process.js";
import { createBashTool } from "./shell/bash.js";
import type { ToolAuditEvent, ToolAuditLogger } from "./types.js";
import { createUserWorkspace, type UserWorkspace } from "./workspace.js";

describe("base tools", () => {
  let root: string;
  let workspace: UserWorkspace;
  let events: ToolAuditEvent[];
  let logger: ToolAuditLogger;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "news-agent-tools-"));
    workspace = await createUserWorkspace(root, "test-user");
    events = [];
    logger = {
      log: (event) => {
        events.push(event);
      },
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes, lists, reads, and searches workspace text files", async () => {
    const write = createWriteFileTool(workspace, logger);
    const list = createListDirTool(workspace, logger);
    const read = createReadFileTool(workspace, logger);
    const search = createSearchContentTool(workspace, logger);

    await write.execute("write-1", {
      path: "briefs/today.md",
      content: "# Daily brief\n\nPi Agent shipped an update.",
    });

    const listed = await list.execute("list-1", { path: "briefs" });
    expect(JSON.parse(listed.content[0]?.text ?? "[]")).toContainEqual({
      name: "today.md",
      type: "file",
    });

    const readResult = await read.execute("read-1", { path: "briefs/today.md" });
    expect(readResult.content[0]?.text).toContain("Pi Agent");

    const searched = await search.execute("search-1", { keyword: "agent", dir: "." });
    expect(searched.details.matchCount).toBe(1);
    expect(JSON.parse(searched.content[0]?.text ?? "[]")[0]).toMatchObject({
      path: "briefs/today.md",
      line: 3,
    });

    expect(events.filter((event) => event.status === "succeeded")).toHaveLength(4);
  });

  it("truncates long reads and leaves no temporary file after an atomic write", async () => {
    const write = createWriteFileTool(workspace, logger);
    const read = createReadFileTool(workspace, logger);
    await write.execute("write-long", { path: "long.txt", content: "a".repeat(13_000) });

    const result = await read.execute("read-long", { path: "long.txt" });
    expect(result.details.truncated).toBe(true);
    expect(result.content[0]?.text).toContain("[Content truncated]");
    expect(await readdir(workspace.workspaceRoot)).toEqual(["long.txt"]);
  });

  it("rejects unsupported output types and logs failures", async () => {
    const write = createWriteFileTool(workspace, logger);
    await expect(
      write.execute("write-bad", { path: "script.js", content: "console.log('no')" }),
    ).rejects.toThrow("Only .md, .json, and .txt");
    expect(events.at(-1)).toMatchObject({ toolName: "write_file", status: "failed" });
  });

  it("runs only allowlisted bash commands", async () => {
    const bash = createBashTool(workspace, logger);
    const version = await bash.execute("bash-version", { command: "node --version" });
    expect(version.content[0]?.text).toMatch(/^v\d+/);

    await expect(bash.execute("bash-danger", { command: "rm -rf ." })).rejects.toThrow(
      "not allowlisted",
    );
    await expect(bash.execute("bash-chain", { command: "node --version && dir" })).rejects.toThrow(
      "Shell operators",
    );
  });

  it("enforces process timeout and output limits", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], {
        cwd: workspace.workspaceRoot,
        timeoutMs: 50,
        maxOutputBytes: 100,
      }),
    ).rejects.toThrow("timed out");

    const capped = await runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(500))"], {
      cwd: workspace.workspaceRoot,
      timeoutMs: 2_000,
      maxOutputBytes: 100,
    });
    expect(Buffer.byteLength(capped.stdout)).toBe(100);
    expect(capped.truncated).toBe(true);
  });

  it("does not forward ambient application secrets to child processes", async () => {
    process.env.NEWS_AGENT_TEST_SECRET = "must-not-leak";
    try {
      const result = await runProcess(
        process.execPath,
        ["-e", "process.stdout.write(process.env.NEWS_AGENT_TEST_SECRET ?? 'missing')"],
        {
          cwd: workspace.workspaceRoot,
          timeoutMs: 2_000,
          maxOutputBytes: 100,
        },
      );
      expect(result.stdout).toBe("missing");
    } finally {
      delete process.env.NEWS_AGENT_TEST_SECRET;
    }
  });
});
