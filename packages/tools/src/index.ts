import { createBashTool } from "./shell/bash.js";
import {
  ArticleRepository,
  BriefRepository,
  SubscriptionRepository,
  type NewsDatabase,
} from "@news-agent/db";
import type { NewsService } from "@news-agent/news";
import { createListDirTool } from "./filesystem/list-dir.js";
import { createReadFileTool } from "./filesystem/read-file.js";
import { createSearchContentTool } from "./filesystem/search-content.js";
import { createWriteFileTool } from "./filesystem/write-file.js";
import { noopToolAuditLogger, type ToolAuditLogger, type ToolDefinition } from "./types.js";
import { createUserWorkspace, type UserWorkspace } from "./workspace.js";
import { createFetchArticleTool } from "./news/fetch-article.js";
import { createFindRelatedArticlesTool } from "./news/find-related-articles.js";
import { createSaveBriefTool } from "./news/save-brief.js";
import { createSearchNewsTool } from "./news/search-news.js";
import { createGetUserPreferencesTool } from "./preferences/get-user-preferences.js";

export interface CreateBaseToolsetOptions {
  dataRoot: string;
  userId: string;
  logger?: ToolAuditLogger;
}

export interface BaseToolset {
  workspace: UserWorkspace;
  tools: ToolDefinition<unknown, unknown>[];
}

export async function createBaseToolset(options: CreateBaseToolsetOptions): Promise<BaseToolset> {
  const workspace = await createUserWorkspace(options.dataRoot, options.userId);
  const logger = options.logger ?? noopToolAuditLogger;
  const tools = [
    createListDirTool(workspace, logger),
    createReadFileTool(workspace, logger),
    createSearchContentTool(workspace, logger),
    createWriteFileTool(workspace, logger),
    createBashTool(workspace, logger),
  ];

  return {
    workspace,
    tools: tools as ToolDefinition<unknown, unknown>[],
  };
}

export interface CreateNewsToolsetOptions {
  db: NewsDatabase;
  newsService: NewsService;
  workspace: UserWorkspace;
  userId: string;
  timezone: string;
  logger?: ToolAuditLogger;
}

export function createNewsToolset(options: CreateNewsToolsetOptions): ToolDefinition<unknown, unknown>[] {
  const logger = options.logger ?? noopToolAuditLogger;
  const articles = new ArticleRepository(options.db);
  const tools = [
    createGetUserPreferencesTool(
      options.userId,
      new SubscriptionRepository(options.db),
      logger,
    ),
    createSearchNewsTool(options.newsService, articles, logger),
    createFetchArticleTool(options.newsService, articles, logger),
    createFindRelatedArticlesTool(options.newsService, articles, logger),
    createSaveBriefTool(
      options.userId,
      options.timezone,
      options.workspace,
      new BriefRepository(options.db),
      articles,
      logger,
    ),
  ];
  return tools as ToolDefinition<unknown, unknown>[];
}

export { createListDirTool } from "./filesystem/list-dir.js";
export { createReadFileTool } from "./filesystem/read-file.js";
export { createSearchContentTool } from "./filesystem/search-content.js";
export { createWriteFileTool } from "./filesystem/write-file.js";
export { createFetchArticleTool } from "./news/fetch-article.js";
export { createFindRelatedArticlesTool } from "./news/find-related-articles.js";
export { createSaveBriefTool } from "./news/save-brief.js";
export { createSearchNewsTool } from "./news/search-news.js";
export { runProcess, type ProcessOptions, type ProcessResult } from "./process.js";
export { createGetUserPreferencesTool } from "./preferences/get-user-preferences.js";
export { createBashTool } from "./shell/bash.js";
export {
  executeWithAudit,
  noopToolAuditLogger,
  type ToolAuditEvent,
  type ToolAuditLogger,
  type ToolDefinition,
  type ToolResult,
} from "./types.js";
export {
  createUserWorkspace,
  resolveWorkspacePath,
  type UserWorkspace,
} from "./workspace.js";
