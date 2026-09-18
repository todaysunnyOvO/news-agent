import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { FastifyInstance } from "fastify";

import type { AppRepositories } from "../types.js";

function markdownPath(dataRoot: string, userId: string, storedPath: string): string {
  if (isAbsolute(storedPath)) throw new Error("Invalid stored Markdown path");
  const userRoot = resolve(dataRoot, "users", userId);
  const candidate = resolve(userRoot, storedPath);
  const fromRoot = relative(userRoot, candidate);
  if (fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) throw new Error("Markdown path escapes user directory");
  return candidate;
}

export async function registerBriefRoutes(
  app: FastifyInstance,
  dependencies: { repositories: AppRepositories; dataRoot: string },
): Promise<void> {
  app.get<{ Params: { userId: string } }>("/api/users/:userId/briefs", async (request, reply) => {
    if (!dependencies.repositories.users.findById(request.params.userId)) return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User not found", statusCode: 404 });
    return dependencies.repositories.briefs.listByUserId(request.params.userId);
  });

  app.get<{ Params: { briefId: string } }>("/api/briefs/:briefId", async (request, reply) => {
    const brief = dependencies.repositories.briefs.findDetailById(request.params.briefId);
    return brief ?? reply.code(404).send({ error: "BRIEF_NOT_FOUND", message: "Brief not found", statusCode: 404 });
  });

  app.get<{ Params: { briefId: string } }>("/api/briefs/:briefId/markdown", async (request, reply) => {
    const brief = dependencies.repositories.briefs.findDetailById(request.params.briefId);
    if (!brief) return reply.code(404).send({ error: "BRIEF_NOT_FOUND", message: "Brief not found", statusCode: 404 });
    const content = await readFile(markdownPath(dependencies.dataRoot, brief.userId, brief.markdownPath), "utf8");
    return reply.type("text/markdown; charset=utf-8").send(content);
  });
}
