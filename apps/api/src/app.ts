import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import {
  AgentRunRepository,
  BriefRepository,
  SubscriptionRepository,
  UserRepository,
  type NewsDatabase,
} from "@news-agent/db";

import { registerUserRoutes } from "./routes/users.js";
import { registerBriefRoutes } from "./routes/briefs.js";
import { registerRunRoutes } from "./routes/runs.js";
import { InMemoryRunEventStore } from "./run-event-store.js";
import { NewsScheduler } from "./scheduler.js";
import type { AgentRunController } from "./types.js";

export interface CreateAppOptions {
  db: NewsDatabase;
  logger?: boolean;
  webOrigin?: string;
  dataRoot?: string;
  agentController?: AgentRunController;
  enableScheduler?: boolean;
  schedulerIntervalMs?: number;
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
  };
  const events = new InMemoryRunEventStore();

  await registerUserRoutes(app, repositories);
  await registerRunRoutes(app, { repositories, events, ...(options.agentController ? { controller: options.agentController } : {}) });
  await registerBriefRoutes(app, { repositories, dataRoot: options.dataRoot ?? "data" });

  if (options.agentController && options.enableScheduler) {
    const scheduler = new NewsScheduler(repositories, options.agentController, events);
    scheduler.start(options.schedulerIntervalMs);
    app.addHook("onClose", async () => scheduler.stop());
  }

  return app;
}
