import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createUserWorkspace, resolveWorkspacePath } from "./workspace.js";

const roots: string[] = [];

async function createTestRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "news-agent-workspace-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("user workspace", () => {
  it("creates isolated workspace and brief directories", async () => {
    const root = await createTestRoot();
    const workspace = await createUserWorkspace(join(root, "data"), "user-123");

    expect(workspace.workspaceRoot).toContain(join("users", "user-123", "workspace"));
    expect(workspace.briefsRoot).toContain(join("users", "user-123", "briefs"));
  });

  it("rejects invalid user IDs and path traversal", async () => {
    const root = await createTestRoot();
    await expect(createUserWorkspace(root, "../outside")).rejects.toThrow("unsupported characters");

    const workspace = await createUserWorkspace(root, "safe-user");
    await expect(
      resolveWorkspacePath(workspace, "../../outside.txt", { mustExist: false }),
    ).rejects.toThrow("escapes");
  });

  it("rejects absolute paths and secret filenames", async () => {
    const root = await createTestRoot();
    const workspace = await createUserWorkspace(root, "safe-user");

    await expect(
      resolveWorkspacePath(workspace, join(root, "outside.txt"), { mustExist: false }),
    ).rejects.toThrow("Absolute paths");
    await expect(
      resolveWorkspacePath(workspace, ".env", { mustExist: false }),
    ).rejects.toThrow("not allowed");
  });

  it("rejects a symbolic link that escapes the workspace", async () => {
    const root = await createTestRoot();
    const workspace = await createUserWorkspace(join(root, "data"), "safe-user");
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret", "utf8");
    await symlink(outside, join(workspace.workspaceRoot, "escape"), "junction");

    await expect(
      resolveWorkspacePath(workspace, "escape/secret.txt", { mustExist: true }),
    ).rejects.toThrow("escapes");
  });
});

