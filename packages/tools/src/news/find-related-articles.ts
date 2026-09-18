import { Type } from "typebox";

import type { ArticleRepository } from "@news-agent/db";
import { clusterNewsEvents, type NewsService } from "@news-agent/news";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";

interface FindRelatedParams {
  articleId: string;
  limit?: number;
}

export function createFindRelatedArticlesTool(
  service: NewsService,
  articles: ArticleRepository,
  logger: ToolAuditLogger,
): ToolDefinition<FindRelatedParams, { articleId: string; count: number; independentSourceCount: number; corroborated: boolean }> {
  return {
    name: "find_related_articles",
    label: "Find related articles",
    description: "Find cached reports about the same or a closely related event.",
    parameters: Type.Object(
      {
        articleId: Type.String({ minLength: 1, maxLength: 100 }),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params) =>
      executeWithAudit(logger, "find_related_articles", toolCallId, async () => {
        const article = articles.findById(params.articleId);
        if (!article) throw new Error("Article ID was not returned by search_news");
        const related = service.findRelated(article, articles.listRecent(200), params.limit ?? 5);
        const cluster = clusterNewsEvents([article, ...related], 0.3)[0];
        const independentSourceCount = cluster?.independentSourceCount ?? 1;
        return {
          content: [{ type: "text", text: JSON.stringify(related) }],
          details: {
            articleId: params.articleId,
            count: related.length,
            independentSourceCount,
            corroborated: independentSourceCount >= 2,
          },
        };
      }),
  };
}
