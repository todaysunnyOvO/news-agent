import {
  lstat,
  mkdir,
  realpath,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface UserWorkspace {
  userId: string;
  userRoot: string;
  workspaceRoot: string;
  briefsRoot: string;
}

const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_NAMES = new Set([".env", ".git", ".ssh"]);

function assertInside(root: string, candidate: string): void {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))) {
    return;
  }
  throw new Error("Path escapes the user workspace");
}

function assertSafeInputPath(inputPath: string): void {
  if (inputPath.includes("\0")) throw new Error("Path contains a null byte");
  if (isAbsolute(inputPath)) throw new Error("Absolute paths are not allowed");

  const segments = inputPath.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    const normalized = segment.toLowerCase();
    if (FORBIDDEN_NAMES.has(normalized) || normalized.startsWith(".env.")) {
      throw new Error(`Access to ${segment} is not allowed`);
    }
  }
}

async function findExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = resolve(current, "..");
      if (parent === current) throw new Error("No existing path ancestor found", { cause: error });
      current = parent;
    }
  }
}

export async function createUserWorkspace(dataRoot: string, userId: string): Promise<UserWorkspace> {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("User ID contains unsupported characters");
  }

  const resolvedDataRoot = resolve(dataRoot);
  const userRoot = resolve(resolvedDataRoot, "users", userId);
  assertInside(resolvedDataRoot, userRoot);

  const workspaceRoot = resolve(userRoot, "workspace");
  const briefsRoot = resolve(userRoot, "briefs");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(briefsRoot, { recursive: true });

  return { userId, userRoot, workspaceRoot, briefsRoot };
}

export async function resolveWorkspacePath(
  workspace: UserWorkspace,
  inputPath: string,
  options: { mustExist: boolean; rejectFinalSymlink?: boolean },
): Promise<string> {
  assertSafeInputPath(inputPath);
  const workspaceRealPath = await realpath(workspace.workspaceRoot);
  const candidate = resolve(workspace.workspaceRoot, inputPath || ".");
  assertInside(workspace.workspaceRoot, candidate);

  if (options.mustExist) {
    const candidateRealPath = await realpath(candidate);
    assertInside(workspaceRealPath, candidateRealPath);
    return candidateRealPath;
  }

  try {
    const stats = await lstat(candidate);
    if (options.rejectFinalSymlink && stats.isSymbolicLink()) {
      throw new Error("Writing through a symbolic link is not allowed");
    }
    const candidateRealPath = await realpath(candidate);
    assertInside(workspaceRealPath, candidateRealPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }

  const ancestor = await findExistingAncestor(candidate);
  const ancestorRealPath = await realpath(ancestor);
  assertInside(workspaceRealPath, ancestorRealPath);
  return candidate;
}
