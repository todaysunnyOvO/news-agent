import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, migrateDatabase } from "@news-agent/db";

import { createApp } from "./app.js";
import { createDemoAgentController } from "./demo-runtime.js";
import { DeliveringAgentController, WebhookDeliveryService } from "./delivery.js";
import { loadEnvironmentFile } from "./env.js";
import { createRealAgentController } from "./real-runtime.js";

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
const agentController = new DeliveringAgentController(
  baseAgentController,
  new WebhookDeliveryService(database.db, process.env.NEWS_AGENT_DELIVERY_WEBHOOK_URL || undefined),
);

const appOptions = {
  db: database.db,
  logger: true,
  dataRoot,
  agentController,
  enableScheduler: true,
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
