import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { Type } from "typebox";

import type { ArticleRepository, BriefRepository } from "@news-agent/db";
import type { SaveBriefInput } from "@news-agent/shared";

import { executeWithAudit, type ToolAuditLogger, type ToolDefinition } from "../types.js";
import type { UserWorkspace } from "../workspace.js";

function localDate(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function renderMarkdown(input: SaveBriefInput, articles: ArticleRepository): string {
  const lines = [`# ${input.title}`, "", input.overview, ""];
  for (const [index, item] of input.items.entries()) {
    lines.push(`## ${index + 1}. ${item.headline}`, "", item.summary, "", `**为什么重要：** ${item.whyItMatters}`, "", `**主题：** ${item.topic}`);
    if (item.section) lines.push("", `**栏目：** ${item.section}`);
    if (item.novelty) lines.push("", `**进展：** ${item.novelty}`);
    if (item.recommendationReason) lines.push("", `**推荐原因：** ${item.recommendationReason}`);
    if (item.evidenceStatus) lines.push("", `**证据状态：** ${item.evidenceStatus}`);
    lines.push("", "**来源：**");
    for (const articleId of item.sourceArticleIds) {
      const article = articles.findById(articleId);
      if (article) lines.push(`- [${article.sourceName}：${article.title}](${article.canonicalUrl})（${article.publishedAt}）`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function createSaveBriefTool(
  currentUserId: string,
  timezone: string,
  workspace: UserWorkspace,
  briefs: BriefRepository,
  articles: ArticleRepository,
  logger: ToolAuditLogger,
): ToolDefinition<SaveBriefInput, { briefId: string; markdownPath: string; itemCount: number }> {
  return {
    name: "save_brief",
    label: "Save brief",
    description: "Validate citations, save a structured news brief, and render its Markdown file.",
    parameters: Type.Object(
      {
        userId: Type.String({ minLength: 1 }),
        runId: Type.String({ minLength: 1, maxLength: 100 }),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        overview: Type.String({ minLength: 1, maxLength: 5_000 }),
        items: Type.Array(
          Type.Object(
            {
              headline: Type.String({ minLength: 1, maxLength: 300 }),
              summary: Type.String({ minLength: 1, maxLength: 5_000 }),
              whyItMatters: Type.String({ minLength: 1, maxLength: 2_000 }),
              topic: Type.String({ minLength: 1, maxLength: 100 }),
              sourceArticleIds: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 10 }),
              section: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("more"), Type.Literal("tracking")])),
              novelty: Type.Optional(Type.Union([Type.Literal("new"), Type.Literal("update"), Type.Literal("ongoing")])),
              recommendationReason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
              evidenceStatus: Type.Optional(Type.Union([Type.Literal("official"), Type.Literal("corroborated"), Type.Literal("single_source"), Type.Literal("unverified")])),
            },
            { additionalProperties: false },
          ),
          { minItems: 1, maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (toolCallId, input) =>
      executeWithAudit(logger, "save_brief", toolCallId, async () => {
        if (input.userId !== currentUserId) throw new Error("Cannot save a brief for another user");
        const existing = briefs.findByRunId(input.runId);
        if (existing) {
          return {
            content: [{ type: "text", text: JSON.stringify(existing) }],
            details: { briefId: existing.id, markdownPath: existing.markdownPath, itemCount: input.items.length },
          };
        }

        const date = localDate(timezone);
        const safeRunId = input.runId.replace(/[^A-Za-z0-9_-]/g, "-");
        const filename = `${date}-${safeRunId}.md`;
        const target = join(workspace.briefsRoot, filename);
        const temporary = `${target}.${randomUUID()}.tmp`;
        const markdown = renderMarkdown(input, articles);
        const markdownPath = relative(workspace.userRoot, target).replaceAll("\\", "/");

        try {
          await writeFile(temporary, markdown, { encoding: "utf8", flag: "wx" });
          await rename(temporary, target);
          const saved = briefs.save(input, { localDate: date, markdownPath });
          return {
            content: [{ type: "text", text: JSON.stringify(saved) }],
            details: { briefId: saved.id, markdownPath, itemCount: input.items.length },
          };
        } catch (error) {
          await rm(temporary, { force: true }).catch(() => undefined);
          await rm(target, { force: true }).catch(() => undefined);
          throw error;
        }
      }),
  };
}
