import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AgentRunRepository,
  createDatabase,
  migrateDatabase,
  SubscriptionRepository,
  UserRepository,
  type DatabaseContext,
} from "@news-agent/db";
import { MockNewsProvider, NewsService, normalizeArticle } from "@news-agent/news";
import type { NewsArticle, Subscription, User } from "@news-agent/shared";

import { createNewsToolset } from "../index.js";
import type { ToolDefinition } from "../types.js";
import { createUserWorkspace, type UserWorkspace } from "../workspace.js";

function fixture(
  articleId: string,
  title: string,
  canonicalUrl: string,
  sourceId: string,
): { article: NewsArticle; content: string } {
  const article = normalizeArticle({
    articleId,
    provider: "mock",
    sourceId,
    sourceName: `Source ${sourceId}`,
    title,
    canonicalUrl,
    publishedAt: "2026-09-17T08:00:00.000Z",
    retrievedAt: "2026-09-17T09:00:00.000Z",
    language: "en",
    summary: `${title} summary`,
  });
  return { article, content: `${title}. Full verified article content.` };
}

function getTool<TParams>(
  tools: ToolDefinition<unknown, unknown>[],
  name: string,
): ToolDefinition<TParams, Record<string, unknown>> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool as ToolDefinition<TParams, Record<string, unknown>>;
}

describe("news domain tools", () => {
  let root: string;
  let database: DatabaseContext;
  let workspace: UserWorkspace;
  let user: User;
  let runId: string;
  let tools: ToolDefinition<unknown, unknown>[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "news-agent-domain-tools-"));
    database = createDatabase(":memory:");
    migrateDatabase(database.db);
    user = new UserRepository(database.db).create({ displayName: "News Reader" });
    new SubscriptionRepository(database.db).upsert(user.id, {
      topics: ["AI Agent"],
      keywords: ["Pi"],
      excludedKeywords: [],
      languages: ["en"],
      sourceIds: ["source-a", "source-b"],
      maxItems: 5,
      scheduleCron: "0 8 * * *",
      timezone: "Asia/Shanghai",
      deliveryChannel: "web",
      enabled: true,
    });
    runId = new AgentRunRepository(database.db).create(user.id);
    workspace = await createUserWorkspace(root, user.id);
    const fixtures = [
      fixture("one", "Pi Agent releases a new research model", "https://one.example/pi", "source-a"),
      fixture("two", "Pi Agent research model improves tool use", "https://two.example/pi", "source-b"),
    ];
    tools = createNewsToolset({
      db: database.db,
      newsService: new NewsService([new MockNewsProvider(fixtures)]),
      workspace,
      userId: user.id,
      timezone: "Asia/Shanghai",
    });
  });

  afterEach(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });

  it("reads preferences, searches, caches, fetches, relates, and saves a brief", async () => {
    const preferences = await getTool<{ userId: string }>(tools, "get_user_preferences").execute(
      "preferences",
      { userId: user.id },
    );
    const parsedPreferences = JSON.parse(preferences.content[0]?.text ?? "{}") as Subscription & { personalizationProfile: { enabled: boolean } };
    expect(parsedPreferences.topics).toEqual([
      "AI Agent",
    ]);
    expect(parsedPreferences.personalizationProfile.enabled).toBe(true);

    const search = await getTool<{ query: string; limit: number }>(tools, "search_news").execute(
      "search",
      { query: "Pi Agent", limit: 10 },
    );
    const results = JSON.parse(search.content[0]?.text ?? "[]") as NewsArticle[];
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty("recommendationReasons");

    const first = results[0];
    if (!first) throw new Error("Expected a search result");
    const fetchTool = getTool<{ articleId: string }>(tools, "fetch_article");
    const fetched = await fetchTool.execute("fetch", { articleId: first.articleId });
    expect(fetched.content[0]?.text).toContain("Full verified article content");
    const cached = await fetchTool.execute("fetch-cached", { articleId: first.articleId });
    expect(cached.details.cached).toBe(true);

    const related = await getTool<{ articleId: string }>(tools, "find_related_articles").execute(
      "related",
      { articleId: first.articleId },
    );
    expect(JSON.parse(related.content[0]?.text ?? "[]")).toHaveLength(1);

    const saved = await getTool<Record<string, unknown>>(tools, "save_brief").execute("save", {
      userId: user.id,
      runId,
      title: "今日 AI 简报",
      overview: "Pi Agent 发布了新的研究模型。",
      items: [
        {
          headline: "Pi Agent 新模型",
          summary: "新的研究模型已经发布。",
          whyItMatters: "开发者获得了新的 Agent 能力。",
          topic: "AI Agent",
          sourceArticleIds: results.map((article) => article.articleId),
        },
      ],
    });
    const savedBrief = JSON.parse(saved.content[0]?.text ?? "{}") as { markdownPath: string };
    const markdownFile = join(workspace.userRoot, savedBrief.markdownPath);
    await expect(access(markdownFile)).resolves.toBeUndefined();
    expect(await readFile(markdownFile, "utf8")).toContain("Source source-a");
  });

  it("refuses to save a brief with an unknown citation", async () => {
    const save = getTool<Record<string, unknown>>(tools, "save_brief");
    await expect(
      save.execute("save-invalid", {
        userId: user.id,
        runId,
        title: "Invalid",
        overview: "Invalid citation",
        items: [
          {
            headline: "Unknown",
            summary: "Unknown",
            whyItMatters: "Unknown",
            topic: "AI",
            sourceArticleIds: ["missing-article"],
          },
        ],
      }),
    ).rejects.toThrow("unknown article IDs");
  });
});
