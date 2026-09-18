import type { FastifyInstance } from "fastify";

import type { AppRepositories, AgentRunController, RunEventStore } from "../types.js";
import { evaluateRun } from "../evaluation.js";

const runParams = {
  type: "object",
  additionalProperties: false,
  required: ["runId"],
  properties: { runId: { type: "string", minLength: 1 } },
} as const;

export async function registerRunRoutes(
  app: FastifyInstance,
  dependencies: { repositories: AppRepositories; controller?: AgentRunController; events: RunEventStore },
): Promise<void> {
  app.post<{ Params: { userId: string } }>("/api/users/:userId/runs", async (request, reply) => {
    if (!dependencies.controller) return reply.code(503).send({ error: "AGENT_UNAVAILABLE", message: "Agent runtime is not configured", statusCode: 503 });
    if (!dependencies.repositories.users.findById(request.params.userId)) return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User not found", statusCode: 404 });
    if (!dependencies.repositories.subscriptions.findByUserId(request.params.userId)) return reply.code(409).send({ error: "SUBSCRIPTION_REQUIRED", message: "Save subscription preferences first", statusCode: 409 });

    const started = dependencies.controller.start({
      userId: request.params.userId,
      trigger: "manual",
      onEvent: (event) => dependencies.events.publish(event),
    });
    void started.completion;
    return reply.code(202).send({ runId: started.runId, status: "queued" });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId", { schema: { params: runParams } }, async (request, reply) => {
    const run = dependencies.repositories.runs.findById(request.params.runId);
    return run ?? reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found", statusCode: 404 });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/evaluation", { schema: { params: runParams } }, async (request, reply) => {
    const run = dependencies.repositories.runs.findById(request.params.runId);
    return run ? evaluateRun(run, dependencies.repositories.briefs) : reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found", statusCode: 404 });
  });

  app.post<{ Params: { runId: string } }>("/api/runs/:runId/cancel", { schema: { params: runParams } }, async (request, reply) => {
    const run = dependencies.repositories.runs.findById(request.params.runId);
    if (!run) return reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found", statusCode: 404 });
    if (!dependencies.controller) return reply.code(503).send({ error: "AGENT_UNAVAILABLE", message: "Agent runtime is not configured", statusCode: 503 });
    const cancelled = await dependencies.controller.cancel(request.params.runId);
    return reply.code(cancelled ? 202 : 409).send({ runId: request.params.runId, cancelled });
  });

  app.get<{ Params: { runId: string } }>("/api/runs/:runId/events", { schema: { params: runParams } }, async (request, reply) => {
    if (!dependencies.repositories.runs.findById(request.params.runId)) return reply.code(404).send({ error: "RUN_NOT_FOUND", message: "Run not found", statusCode: 404 });
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let closed = false;
    let unsubscribe = (): void => undefined;
    const send = (event: ReturnType<RunEventStore["list"]>[number]): void => {
      if (closed) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      if (event.type === "run_finished") {
        closed = true;
        unsubscribe();
        reply.raw.end();
      }
    };
    unsubscribe = dependencies.events.subscribe(request.params.runId, send);
    request.raw.once("close", () => { closed = true; unsubscribe(); });
    for (const event of dependencies.events.list(request.params.runId)) send(event);
  });
}
