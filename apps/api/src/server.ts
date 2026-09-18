import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase } from "@news-agent/db";

import { createApp } from "./app.js";
import { createDemoAgentController } from "./demo-runtime.js";
import {
  DeliveringAgentController,
  DeliveryService,
  ResendEmailAdapter,
  WebhookDeliveryAdapter,
  type DeliveryAdapter,
} from "./delivery.js";
import { loadEnvironmentFile } from "./env.js";
import { createRealAgentController } from "./real-runtime.js";
import { FeedbackActionSigner } from "./signed-actions.js";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadEnvironmentFile(resolve(projectRoot, ".env"));

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");
const configuredDatabasePath = process.env.NEWS_AGENT_DB_PATH ?? "data/news-agent.sqlite";
const databasePath = isAbsolute(configuredDatabasePath)
  ? configuredDatabasePath
  : resolve(projectRoot, configuredDatabasePath);
const configuredDataRoot = process.env.NEWS_AGENT_DATA_ROOT ?? "data";
const dataRoot = isAbsolute(configuredDataRoot) ? configuredDataRoot : resolve(projectRoot, configuredDataRoot);

const database = createDatabase(databasePath);
migrateDatabase(database.db);
const provider = process.env.NEWS_AGENT_MODEL_PROVIDER ?? "deepseek";
const modelId = process.env.NEWS_AGENT_MODEL_ID ?? "deepseek-v4-flash";
const tavilyApiKey = process.env.TAVILY_API_KEY;
const useRealRuntime = Boolean(process.env.DEEPSEEK_API_KEY && tavilyApiKey);
const baseAgentController = useRealRuntime && tavilyApiKey
  ? await createRealAgentController(database.db, dataRoot, { provider, modelId, tavilyApiKey })
  : await createDemoAgentController(database.db, dataRoot);
const deliveryAdapters: DeliveryAdapter[] = [];
if (process.env.NEWS_AGENT_DELIVERY_WEBHOOK_URL) {
  deliveryAdapters.push(new WebhookDeliveryAdapter(process.env.NEWS_AGENT_DELIVERY_WEBHOOK_URL));
}
const emailValues = [
  process.env.RESEND_API_KEY,
  process.env.NEWS_AGENT_EMAIL_FROM,
  process.env.NEWS_AGENT_EMAIL_TO,
  process.env.NEWS_AGENT_FEEDBACK_SIGNING_SECRET,
];
if (emailValues.some(Boolean) && !emailValues.every(Boolean)) {
  throw new Error("Resend email delivery requires RESEND_API_KEY, NEWS_AGENT_EMAIL_FROM, NEWS_AGENT_EMAIL_TO, and NEWS_AGENT_FEEDBACK_SIGNING_SECRET");
}
const feedbackActionSigner = process.env.NEWS_AGENT_FEEDBACK_SIGNING_SECRET
  ? new FeedbackActionSigner(process.env.NEWS_AGENT_FEEDBACK_SIGNING_SECRET)
  : undefined;
if (emailValues.every(Boolean)) {
  deliveryAdapters.push(new ResendEmailAdapter(
    process.env.RESEND_API_KEY!,
    process.env.NEWS_AGENT_EMAIL_FROM!,
    process.env.NEWS_AGENT_EMAIL_TO!,
  ));
}
const deliveryService = deliveryAdapters.length > 0
  ? new DeliveryService(
      database.db,
      deliveryAdapters,
      process.env.NEWS_AGENT_PUBLIC_BASE_URL ?? "http://127.0.0.1:5173",
      feedbackActionSigner,
    )
  : undefined;
const agentController = deliveryService
  ? new DeliveringAgentController(baseAgentController, deliveryService)
  : baseAgentController;

const appOptions = {
  db: database.db,
  logger: true,
  dataRoot,
  agentController,
  enableScheduler: true,
  ...(deliveryService ? {
    deliveryService,
    enableDeliveryWorker: true,
    ...(feedbackActionSigner ? { feedbackActionSigner } : {}),
  } : {}),
  ...(process.env.WEB_ORIGIN ? { webOrigin: process.env.WEB_ORIGIN } : {}),
};
const app = await createApp(appOptions);

const shutdown = async (): Promise<void> => {
  await app.close();
  database.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host, port });
