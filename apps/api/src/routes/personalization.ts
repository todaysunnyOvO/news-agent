import type { FastifyInstance } from "fastify";

import type { NewsDatabase } from "@news-agent/db";
import { PersonalizationService } from "@news-agent/personalization";
import type { InferredPreferenceStatus } from "@news-agent/shared";

import type { AppRepositories } from "../types.js";

const userParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: { userId: { type: "string", minLength: 1 } },
} as const;

const preferenceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["preferenceId"],
  properties: { preferenceId: { type: "string", minLength: 1 } },
} as const;

export async function registerPersonalizationRoutes(
  app: FastifyInstance,
  repositories: AppRepositories,
  db: NewsDatabase,
): Promise<void> {
  const service = new PersonalizationService(db);

  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId/preference-profile",
    { schema: { params: userParamsSchema } },
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) {
        return reply.code(404).send({ error: "USER_NOT_FOUND", message: "User not found", statusCode: 404 });
      }
      if (!repositories.subscriptions.findByUserId(request.params.userId)) {
        return reply.code(404).send({ error: "SUBSCRIPTION_NOT_FOUND", message: "Subscription not found", statusCode: 404 });
      }
      return service.refresh(request.params.userId);
    },
  );

  app.patch<{ Params: { userId: string }; Body: { enabled: boolean } }>(
    "/api/users/:userId/personalization",
    {
      schema: {
        params: userParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["enabled"],
          properties: { enabled: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const subscription = repositories.subscriptions.findByUserId(request.params.userId);
      if (!subscription) {
        return reply.code(404).send({ error: "SUBSCRIPTION_NOT_FOUND", message: "Subscription not found", statusCode: 404 });
      }
      return repositories.subscriptions.upsert(request.params.userId, {
        ...subscription,
        personalizationEnabled: request.body.enabled,
      });
    },
  );

  app.patch<{
    Params: { preferenceId: string };
    Body: { userId: string; status?: InferredPreferenceStatus; weight?: number };
  }>(
    "/api/inferred-preferences/:preferenceId",
    {
      schema: {
        params: preferenceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          minProperties: 2,
          properties: {
            userId: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["suggested", "accepted", "dismissed"] },
            weight: { type: "number", minimum: -2, maximum: 2 },
          },
        },
      },
    },
    async (request, reply) => {
      const preference = repositories.inferredPreferences.update(
        request.body.userId,
        request.params.preferenceId,
        { ...(request.body.status ? { status: request.body.status } : {}), ...(request.body.weight !== undefined ? { weight: request.body.weight } : {}) },
      );
      if (!preference) {
        return reply.code(404).send({ error: "PREFERENCE_NOT_FOUND", message: "Inferred preference not found", statusCode: 404 });
      }
      return preference;
    },
  );

  app.delete<{ Params: { preferenceId: string }; Body: { userId: string } }>(
    "/api/inferred-preferences/:preferenceId",
    {
      schema: {
        params: preferenceParamsSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const removed = repositories.inferredPreferences.delete(request.body.userId, request.params.preferenceId);
      if (!removed) {
        return reply.code(404).send({ error: "PREFERENCE_NOT_FOUND", message: "Inferred preference not found", statusCode: 404 });
      }
      return { removed: true };
    },
  );
}
