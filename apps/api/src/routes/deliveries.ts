import type { FastifyInstance } from "fastify";

import type { DeliveryService } from "../delivery.js";
import type { FeedbackActionSigner } from "../signed-actions.js";
import type { AppRepositories } from "../types.js";

export async function registerDeliveryRoutes(
  app: FastifyInstance,
  dependencies: {
    repositories: AppRepositories;
    delivery?: DeliveryService;
    signer?: FeedbackActionSigner;
  },
): Promise<void> {
  app.get<{ Params: { briefId: string } }>(
    "/api/briefs/:briefId/deliveries",
    async (request, reply) => {
      if (!dependencies.repositories.briefs.findDetailById(request.params.briefId)) {
        return reply.code(404).send({ error: "BRIEF_NOT_FOUND", message: "Brief not found", statusCode: 404 });
      }
      return dependencies.repositories.deliveries.listByBriefId(request.params.briefId).map((job) => ({
        ...job,
        attempts: dependencies.repositories.deliveries.listAttempts(job.id),
      }));
    },
  );

  app.post<{ Params: { briefId: string }; Body: { userId: string } }>(
    "/api/briefs/:briefId/deliver",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const brief = dependencies.repositories.briefs.findDetailById(request.params.briefId);
      if (!brief || brief.userId !== request.body.userId) {
        return reply.code(404).send({ error: "BRIEF_NOT_FOUND", message: "Brief not found", statusCode: 404 });
      }
      if (!dependencies.delivery) {
        return reply.code(503).send({ error: "DELIVERY_UNAVAILABLE", message: "Delivery is not configured", statusCode: 503 });
      }
      try {
        const job = await dependencies.delivery.enqueueBrief(brief.id);
        if (!job) return reply.code(409).send({ error: "DELIVERY_DISABLED", message: "Select email or webhook delivery first", statusCode: 409 });
        return reply.code(202).send(job);
      } catch (error) {
        return reply.code(409).send({ error: "DELIVERY_NOT_CONFIGURED", message: error instanceof Error ? error.message : "Delivery is not configured", statusCode: 409 });
      }
    },
  );

  app.post<{ Params: { deliveryId: string }; Body: { userId: string } }>(
    "/api/deliveries/:deliveryId/retry",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["userId"],
          properties: { userId: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const current = dependencies.repositories.deliveries.findById(request.params.deliveryId);
      if (!current || current.userId !== request.body.userId) {
        return reply.code(404).send({ error: "DELIVERY_NOT_FOUND", message: "Delivery not found", statusCode: 404 });
      }
      if (!dependencies.delivery) {
        return reply.code(503).send({ error: "DELIVERY_UNAVAILABLE", message: "Delivery is not configured", statusCode: 503 });
      }
      const job = await dependencies.delivery.retry(current.id);
      return job ?? reply.code(409).send({ error: "DELIVERY_NOT_RETRYABLE", message: "Delivery cannot be retried", statusCode: 409 });
    },
  );

  app.get<{ Querystring: { token: string } }>(
    "/api/email-actions/feedback",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", minLength: 1, maxLength: 4096 } },
        },
      },
    },
    async (request, reply) => {
      const payload = dependencies.signer?.verify(request.query.token);
      if (!payload) return reply.code(400).type("text/html; charset=utf-8").send("<h1>反馈链接无效或已过期</h1>");
      const detail = dependencies.repositories.briefs.findDetailById(payload.briefId);
      if (!detail || detail.userId !== payload.userId || !detail.items.some((item) => item.id === payload.itemId)) {
        return reply.code(404).type("text/html; charset=utf-8").send("<h1>简报条目不存在</h1>");
      }
      const saved = dependencies.repositories.feedback.setItemFeedback(payload.userId, payload.itemId, payload.type, true);
      if (!saved) return reply.code(404).type("text/html; charset=utf-8").send("<h1>无法保存反馈</h1>");
      return reply.type("text/html; charset=utf-8").send("<h1>反馈已记录</h1><p>你可以关闭此页面。</p>");
    },
  );
}
