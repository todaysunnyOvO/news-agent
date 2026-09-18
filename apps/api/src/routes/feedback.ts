import type { FastifyInstance } from "fastify";

import type {
  BriefItemFeedbackType,
  TrackedTopicStatus,
  UpsertBriefFeedbackInput,
} from "@news-agent/shared";

import type { AppRepositories } from "../types.js";

const userBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: { userId: { type: "string", minLength: 1 } },
} as const;

const feedbackTypes: BriefItemFeedbackType[] = [
  "useful",
  "not_interested",
  "already_known",
  "repetitive",
];
const trackedStatuses: TrackedTopicStatus[] = ["active", "paused", "closed"];

function notFound(reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(404).send({
    error: "RESOURCE_NOT_FOUND",
    message: "The requested resource was not found for this user",
    statusCode: 404,
  });
}

export async function registerFeedbackRoutes(
  app: FastifyInstance,
  repositories: AppRepositories,
): Promise<void> {
  app.get<{ Params: { briefId: string }; Querystring: { userId: string } }>(
    "/api/briefs/:briefId/feedback",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["briefId"],
          properties: { briefId: { type: "string", minLength: 1 } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) =>
      repositories.feedback.getSummary(request.query.userId, request.params.briefId) ??
      notFound(reply),
  );

  app.put<{
    Params: { briefId: string };
    Body: UpsertBriefFeedbackInput & { userId: string };
  }>(
    "/api/briefs/:briefId/feedback",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: {
            userId: { type: "string", minLength: 1 },
            usefulness: {
              anyOf: [
                { type: "string", enum: ["useful", "neutral", "not_useful"] },
                { type: "null" },
              ],
            },
            lengthRating: {
              anyOf: [
                { type: "string", enum: ["too_short", "about_right", "too_long"] },
                { type: "null" },
              ],
            },
            missedImportantNews: { type: "boolean" },
            comment: { anyOf: [{ type: "string", maxLength: 1000 }, { type: "null" }] },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, ...input } = request.body;
      return repositories.feedback.upsertBrief(userId, request.params.briefId, input) ?? notFound(reply);
    },
  );

  app.put<{
    Params: { itemId: string; type: BriefItemFeedbackType };
    Body: { userId: string };
  }>(
    "/api/brief-items/:itemId/feedback/:type",
    {
      schema: {
        body: userBodySchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "type"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            type: { type: "string", enum: feedbackTypes },
          },
        },
      },
    },
    async (request, reply) =>
      repositories.feedback.setItemFeedback(
        request.body.userId,
        request.params.itemId,
        request.params.type,
        true,
      ) ?? notFound(reply),
  );

  app.delete<{
    Params: { itemId: string; type: BriefItemFeedbackType };
    Body: { userId: string };
  }>(
    "/api/brief-items/:itemId/feedback/:type",
    {
      schema: {
        body: userBodySchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "type"],
          properties: {
            itemId: { type: "string", minLength: 1 },
            type: { type: "string", enum: feedbackTypes },
          },
        },
      },
    },
    async (request, reply) =>
      repositories.feedback.setItemFeedback(
        request.body.userId,
        request.params.itemId,
        request.params.type,
        false,
      ) ?? notFound(reply),
  );

  app.put<{ Params: { itemId: string }; Body: { userId: string } }>(
    "/api/brief-items/:itemId/saved",
    { schema: { body: userBodySchema } },
    async (request, reply) =>
      repositories.library.saveItem(request.body.userId, request.params.itemId) ?? notFound(reply),
  );

  app.delete<{ Params: { itemId: string }; Body: { userId: string } }>(
    "/api/brief-items/:itemId/saved",
    { schema: { body: userBodySchema } },
    async (request) => ({
      removed: repositories.library.removeSavedItem(request.body.userId, request.params.itemId),
    }),
  );

  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId/saved-items",
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) return notFound(reply);
      return repositories.library.listSavedItems(request.params.userId);
    },
  );

  app.post<{ Params: { itemId: string }; Body: { userId: string; label?: string } }>(
    "/api/brief-items/:itemId/tracking",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: {
            userId: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) =>
      repositories.library.trackItem(
        request.body.userId,
        request.params.itemId,
        request.body.label,
      ) ?? notFound(reply),
  );

  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId/tracked-topics",
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) return notFound(reply);
      return repositories.library.listTrackedTopics(request.params.userId);
    },
  );

  app.patch<{
    Params: { trackingId: string };
    Body: { userId: string; label?: string; status?: TrackedTopicStatus };
  }>(
    "/api/tracked-topics/:trackingId",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: {
            userId: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1, maxLength: 200 },
            status: { type: "string", enum: trackedStatuses },
          },
        },
      },
    },
    async (request, reply) => {
      const { userId, ...input } = request.body;
      return repositories.library.updateTrackedTopic(
        userId,
        request.params.trackingId,
        input,
      ) ?? notFound(reply);
    },
  );
}
