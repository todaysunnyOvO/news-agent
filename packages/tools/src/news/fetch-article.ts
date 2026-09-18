import { Type } from "typebox";

import type { ArticleRepository } from "@news-agent/db";
import type { NewsService } from "@news-agent/news";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";

interface FetchArticleParams {
  articleId: string;
}

const MAX_MODEL_CHARACTERS = 12_000;

export function createFetchArticleTool(
  service: NewsService,
  articles: ArticleRepository,
  logger: ToolAuditLogger,
): ToolDefinition<FetchArticleParams, { articleId: string; cached: boolean; truncated: boolean }> {
  return {
    name: "fetch_article",
    label: "Fetch article",
    description: "Fetch and extract a previously searched article by its registered article ID.",
    parameters: Type.Object(
      { articleId: Type.String({ minLength: 1, maxLength: 100 }) },
      { additionalProperties: false },
    ),
    execute: async (toolCallId, params, signal) =>
      executeWithAudit(logger, "fetch_article", toolCallId, async () => {
        const cached = articles.findFetchedById(params.articleId);
        const source = cached ?? articles.findById(params.articleId);
        if (!source) throw new Error("Article ID was not returned by search_news");
        const fetched = cached ?? (await service.fetch(source, signal));
        if (!cached) articles.updateContent(fetched);

        const truncated = fetched.content.length > MAX_MODEL_CHARACTERS;
        const result = {
          ...fetched,
          content: truncated ? fetched.content.slice(0, MAX_MODEL_CHARACTERS) : fetched.content,
          truncated: fetched.truncated || truncated,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: { articleId: params.articleId, cached: Boolean(cached), truncated: result.truncated },
        };
      }),
  };
}
