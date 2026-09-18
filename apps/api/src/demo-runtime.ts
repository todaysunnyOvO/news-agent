import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { NewsAgentService, type RunNewsAgentInput, type StartedNewsAgentRun } from "@news-agent/agent";
import type { NewsDatabase } from "@news-agent/db";
import { createArticleId, MockNewsProvider, NewsService } from "@news-agent/news";

import type { AgentRunController } from "./types.js";

function userText(context: Context): string {
  return context.messages.flatMap((message) => message.role === "user"
    ? (typeof message.content === "string" ? [message.content] : message.content.flatMap((part) => part.type === "text" ? [part.text] : []))
    : []).join("\n");
}

export async function createDemoAgentController(db: NewsDatabase, dataRoot: string): Promise<AgentRunController> {
  const url = "https://example.com/news/pi-agent-mvp";
  const articleId = createArticleId(url);
  const newsService = new NewsService([new MockNewsProvider([{
    article: {
      articleId,
      provider: "mock",
      sourceId: "demo-source",
      sourceName: "Demo News",
      title: "Pi Agent powers a personalized daily news workflow",
      canonicalUrl: url,
      publishedAt: new Date().toISOString(),
      retrievedAt: new Date().toISOString(),
      language: "en",
      summary: "A local demonstration article for the news assistant MVP.",
    },
    content: "The demo shows preference-aware search, article reading, citations, and persisted briefs.",
  }])]);
  const faux = fauxProvider({ provider: `news-agent-demo-${crypto.randomUUID()}`, tokensPerSecond: 100_000 });
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, modelsPath: null });
  runtime.registerNativeProvider(faux.provider);
  const service = new NewsAgentService({ db, newsService, dataRoot, model: faux.getModel(), modelRuntime: runtime });
  let active = false;

  const controller: AgentRunController = {
    start(input: RunNewsAgentInput): StartedNewsAgentRun {
      if (active) throw new Error("The local demo model supports one run at a time");
      active = true;
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("get_user_preferences", {}, { id: crypto.randomUUID() }), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("search_news", { query: "agent", limit: 5 }, { id: crypto.randomUUID() }), { stopReason: "toolUse" }),
        fauxAssistantMessage(fauxToolCall("fetch_article", { articleId }, { id: crypto.randomUUID() }), { stopReason: "toolUse" }),
        (context) => {
          const text = userText(context);
          const runId = /Current runId: ([^\s]+)/.exec(text)?.[1] ?? "";
          const userId = /Current userId: ([^\s]+)/.exec(text)?.[1] ?? "";
          return fauxAssistantMessage(fauxToolCall("save_brief", {
            userId,
            runId,
            title: "每日 AI 新闻简报",
            overview: "本地 Mock 数据生成的可验证演示简报。",
            items: [{
              headline: "Pi Agent 驱动个性化每日新闻工作流",
              summary: "该演示串联了偏好读取、搜索、正文读取、引用和持久化。",
              whyItMatters: "展示垂类 Agent 如何把通用循环转化为可靠产品流程。",
              topic: "AI Agent",
              sourceArticleIds: [articleId],
            }],
          }, { id: crypto.randomUUID() }), { stopReason: "toolUse" });
        },
        fauxAssistantMessage("简报已保存。"),
      ]);
      const started = service.start(input);
      void started.completion.finally(() => { active = false; });
      return started;
    },
    cancel: (runId) => service.cancel(runId),
  };
  return controller;
}
