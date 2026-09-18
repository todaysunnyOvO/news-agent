import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topicsJson: text("topics_json").notNull(),
    keywordsJson: text("keywords_json").notNull(),
    excludedKeywordsJson: text("excluded_keywords_json").notNull(),
    languagesJson: text("languages_json").notNull(),
    sourceIdsJson: text("source_ids_json").notNull(),
    maxItems: integer("max_items").notNull(),
    scheduleCron: text("schedule_cron").notNull(),
    timezone: text("timezone").notNull(),
    deliveryChannel: text("delivery_channel").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("subscriptions_user_id_unique").on(table.userId)],
);

export const articles = sqliteTable(
  "articles",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    title: text("title").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    author: text("author"),
    language: text("language").notNull(),
    publishedAt: text("published_at").notNull(),
    eventTime: text("event_time"),
    summary: text("summary"),
    content: text("content"),
    contentHash: text("content_hash"),
    retrievedAt: text("retrieved_at").notNull(),
  },
  (table) => [uniqueIndex("articles_canonical_url_unique").on(table.canonicalUrl)],
);

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  model: text("model").notNull(),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  turnCount: integer("turn_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsdMicros: integer("cost_usd_micros").notNull().default(0),
  errorMessage: text("error_message"),
  idempotencyKey: text("idempotency_key"),
}, (table) => [uniqueIndex("agent_runs_idempotency_key_unique").on(table.idempotencyKey)]);

export const deliveryAttempts = sqliteTable(
  "delivery_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    deliveredAt: text("delivered_at"),
  },
  (table) => [uniqueIndex("delivery_attempts_run_channel_unique").on(table.runId, table.channel)],
);

export const briefs = sqliteTable(
  "briefs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    localDate: text("local_date").notNull(),
    title: text("title").notNull(),
    overview: text("overview").notNull(),
    markdownPath: text("markdown_path").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("briefs_run_id_unique").on(table.runId)],
);

export const briefItems = sqliteTable("brief_items", {
  id: text("id").primaryKey(),
  briefId: text("brief_id")
    .notNull()
    .references(() => briefs.id, { onDelete: "cascade" }),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  whyItMatters: text("why_it_matters").notNull(),
  topic: text("topic").notNull(),
  rank: integer("rank").notNull(),
});

export const briefItemSources = sqliteTable(
  "brief_item_sources",
  {
    briefItemId: text("brief_item_id")
      .notNull()
      .references(() => briefItems.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.briefItemId, table.articleId] })],
);
