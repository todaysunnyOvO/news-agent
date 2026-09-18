import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import {
  AgentRunRepository,
  BriefRepository,
  DeliveryRepository,
  FeedbackRepository,
  InferredPreferenceRepository,
  LibraryRepository,
  SubscriptionRepository,
  UserRepository,
  type NewsDatabase,
} from "@news-agent/db";

import { registerUserRoutes } from "./routes/users.js";
import { registerBriefRoutes } from "./routes/briefs.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";
import { registerDeliveryRoutes } from "./routes/deliveries.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerPersonalizationRoutes } from "./routes/personalization.js";
import { InMemoryRunEventStore } from "./run-event-store.js";
import { NewsScheduler } from "./scheduler.js";
import type { AgentRunController } from "./types.js";
import { DeliveryWorker, type DeliveryService } from "./delivery.js";
import type { FeedbackActionSigner } from "./signed-actions.js";

export interface CreateAppOptions {
  db: NewsDatabase;
  logger?: boolean;
  webOrigin?: string;
  dataRoot?: string;
  agentController?: AgentRunController;
  enableScheduler?: boolean;
  schedulerIntervalMs?: number;
  deliveryService?: DeliveryService;
  feedbackActionSigner?: FeedbackActionSigner;
  enableDeliveryWorker?: boolean;
  deliveryWorkerIntervalMs?: number;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: options.webOrigin ?? "http://localhost:5173",
  });

  app.get("/health", async () => ({ status: "ok" }));

  const repositories = {
    users: new UserRepository(options.db),
    subscriptions: new SubscriptionRepository(options.db),
    runs: new AgentRunRepository(options.db),
    briefs: new BriefRepository(options.db),
    feedback: new FeedbackRepository(options.db),
    inferredPreferences: new InferredPreferenceRepository(options.db),
    library: new LibraryRepository(options.db),
    deliveries: new DeliveryRepository(options.db),
  };
  const events = new InMemoryRunEventStore();

  await registerUserRoutes(app, repositories);
  await registerRunRoutes(app, { repositories, events, ...(options.agentController ? { controller: options.agentController } : {}) });
  await registerBriefRoutes(app, { repositories, dataRoot: options.dataRoot ?? "data" });
  await registerFeedbackRoutes(app, repositories);
  await registerPersonalizationRoutes(app, repositories, options.db);
  await registerDeliveryRoutes(app, {
    repositories,
    ...(options.deliveryService ? { delivery: options.deliveryService } : {}),
    ...(options.feedbackActionSigner ? { signer: options.feedbackActionSigner } : {}),
  });

  if (options.agentController && options.enableScheduler) {
    const scheduler = new NewsScheduler(repositories, options.agentController, events);
    scheduler.start(options.schedulerIntervalMs);
    app.addHook("onClose", async () => scheduler.stop());
  }

  if (options.deliveryService && options.enableDeliveryWorker) {
    const worker = new DeliveryWorker(options.deliveryService);
    worker.start(options.deliveryWorkerIntervalMs);
    app.addHook("onClose", async () => worker.stop());
  }

  return app;
}
