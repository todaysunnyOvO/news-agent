import { Type } from "typebox";

import type { ArticleRepository } from "@news-agent/db";
import type { NewsService } from "@news-agent/news";
import type { NewsSearchRequest } from "@news-agent/shared";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";

export function createSearchNewsTool(
  service: NewsService,
  articles: ArticleRepository,
  logger: ToolAuditLogger,
): ToolDefinition<NewsSearchRequest, { count: number }> {
  return {
    name: "search_news",
    label: "Search news",
    description: "Search configured news providers by topic, time, language, and source.",
    parameters: Type.Object(
      {
        query: Type.String({ minLength: 1, maxLength: 300 }),
        from: Type.Optional(Type.String({ format: "date-time" })),
        to: Type.Optional(Type.String({ format: "date-time" })),
        language: Type.Optional(Type.String({ minLength: 2, maxLength: 20 })),
        sourceIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 30 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params, signal) =>
      executeWithAudit(logger, "search_news", toolCallId, async () => {
        const results = await service.search(params, signal);
        articles.upsertMany(results);
        return {
          content: [{ type: "text", text: JSON.stringify(results) }],
          details: { count: results.length },
        };
      }),
  };
}
