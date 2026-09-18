import type { FastifyInstance } from "fastify";

import type { UpsertSubscriptionInput } from "@news-agent/shared";

import type { AppRepositories } from "../types.js";

const idParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId"],
  properties: {
    userId: { type: "string", minLength: 1 },
  },
} as const;

const subscriptionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "topics",
    "keywords",
    "excludedKeywords",
    "languages",
    "sourceIds",
    "maxItems",
    "scheduleCron",
    "timezone",
    "deliveryChannel",
    "enabled",
  ],
  properties: {
    topics: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 30 },
    keywords: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 50 },
    excludedKeywords: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 50 },
    languages: { type: "array", items: { type: "string", minLength: 2 }, minItems: 1, maxItems: 10 },
    sourceIds: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 30 },
    maxItems: { type: "integer", minimum: 1, maximum: 20 },
    scheduleCron: { type: "string", minLength: 1, maxLength: 100 },
    timezone: { type: "string", minLength: 1, maxLength: 100 },
    deliveryChannel: { type: "string", enum: ["web", "email", "webhook"] },
    enabled: { type: "boolean" },
  },
} as const;

export async function registerUserRoutes(
  app: FastifyInstance,
  repositories: AppRepositories,
): Promise<void> {
  app.post<{ Body: { displayName: string } }>(
    "/api/users",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["displayName"],
          properties: {
            displayName: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = repositories.users.create({ displayName: request.body.displayName });
      return reply.code(201).send(user);
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      const user = repositories.users.findById(request.params.userId);
      if (!user) {
        return reply.code(404).send({
          error: "USER_NOT_FOUND",
          message: "User not found",
          statusCode: 404,
        });
      }
      return user;
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/api/users/:userId/subscription",
    { schema: { params: idParamsSchema } },
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) {
        return reply.code(404).send({
          error: "USER_NOT_FOUND",
          message: "User not found",
          statusCode: 404,
        });
      }

      const subscription = repositories.subscriptions.findByUserId(request.params.userId);
      if (!subscription) {
        return reply.code(404).send({
          error: "SUBSCRIPTION_NOT_FOUND",
          message: "Subscription not found",
          statusCode: 404,
        });
      }
      return subscription;
    },
  );

  app.put<{ Params: { userId: string }; Body: UpsertSubscriptionInput }>(
    "/api/users/:userId/subscription",
    { schema: { params: idParamsSchema, body: subscriptionBodySchema } },
    async (request, reply) => {
      if (!repositories.users.findById(request.params.userId)) {
        return reply.code(404).send({
          error: "USER_NOT_FOUND",
          message: "User not found",
          statusCode: 404,
        });
      }

      const subscription = repositories.subscriptions.upsert(
        request.params.userId,
        request.body,
      );
      return reply.code(200).send(subscription);
    },
  );
}

