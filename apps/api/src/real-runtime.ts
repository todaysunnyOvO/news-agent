import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NewsAgentService } from "@news-agent/agent";
import type { NewsDatabase } from "@news-agent/db";
import { defaultRssSources, NewsService, RssNewsProvider, TavilyNewsProvider } from "@news-agent/news";

import type { AgentRunController } from "./types.js";

export async function createRealAgentController(
  db: NewsDatabase,
  dataRoot: string,
  configuration: { provider: string; modelId: string; tavilyApiKey: string },
): Promise<AgentRunController> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const model = runtime.getModel(configuration.provider, configuration.modelId);
  if (!model) throw new Error(`Model is not available in Pi SDK: ${configuration.provider}/${configuration.modelId}`);
  const auth = await runtime.checkAuth(configuration.provider);
  if (!auth) throw new Error(`Authentication is not configured for provider: ${configuration.provider}`);

  const newsService = new NewsService([
    new TavilyNewsProvider(configuration.tavilyApiKey),
    new RssNewsProvider(defaultRssSources),
  ]);
  return new NewsAgentService({ db, newsService, dataRoot, model, modelRuntime: runtime });
}
