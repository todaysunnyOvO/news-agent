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
    pausedUntil: text("paused_until"),
    skipDatesJson: text("skip_dates_json").notNull().default("[]"),
    personalizationEnabled: integer("personalization_enabled", { mode: "boolean" }).notNull().default(true),
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
  section: text("section"),
  novelty: text("novelty"),
  recommendationReason: text("recommendation_reason"),
  evidenceStatus: text("evidence_status"),
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

export const deliveryJobs = sqliteTable(
  "delivery_jobs",
  {
    id: text("id").primaryKey(),
    briefId: text("brief_id").notNull().references(() => briefs.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    destinationHash: text("destination_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: text("next_attempt_at"),
    lastError: text("last_error"),
    deliveredAt: text("delivered_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("delivery_jobs_idempotency_key_unique").on(table.idempotencyKey),
    uniqueIndex("delivery_jobs_run_channel_unique").on(table.runId, table.channel),
  ],
);

export const deliveryAttempts = sqliteTable("delivery_attempts", {
  id: text("id").primaryKey(),
  deliveryJobId: text("delivery_job_id").notNull().references(() => deliveryJobs.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull(),
  providerMessageId: text("provider_message_id"),
  errorCode: text("error_code"),
  durationMs: integer("duration_ms").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("delivery_attempts_job_number_unique").on(table.deliveryJobId, table.attemptNumber),
]);

export const briefFeedback = sqliteTable(
  "brief_feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    briefId: text("brief_id")
      .notNull()
      .references(() => briefs.id, { onDelete: "cascade" }),
    usefulness: text("usefulness"),
    lengthRating: text("length_rating"),
    missedImportantNews: integer("missed_important_news", { mode: "boolean" })
      .notNull()
      .default(false),
    comment: text("comment"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("brief_feedback_user_brief_unique").on(table.userId, table.briefId)],
);

export const briefItemFeedback = sqliteTable(
  "brief_item_feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    briefItemId: text("brief_item_id")
      .notNull()
      .references(() => briefItems.id, { onDelete: "cascade" }),
    feedbackType: text("feedback_type").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("brief_item_feedback_user_item_type_unique").on(
      table.userId,
      table.briefItemId,
      table.feedbackType,
    ),
  ],
);

export const savedItems = sqliteTable(
  "saved_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    briefItemId: text("brief_item_id")
      .notNull()
      .references(() => briefItems.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("saved_items_user_item_unique").on(table.userId, table.briefItemId)],
);

export const trackedTopics = sqliteTable(
  "tracked_topics",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    queryJson: text("query_json").notNull(),
    status: text("status").notNull(),
    sourceBriefItemId: text("source_brief_item_id").references(() => briefItems.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("tracked_topics_user_source_unique").on(table.userId, table.sourceBriefItemId),
  ],
);

export const inferredPreferences = sqliteTable(
  "inferred_preferences",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    weight: integer("weight").notNull(),
    confidence: integer("confidence").notNull(),
    status: text("status").notNull(),
    evidenceCount: integer("evidence_count").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    lastReinforcedAt: text("last_reinforced_at").notNull(),
    expiresAt: text("expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("inferred_preferences_user_kind_value_unique").on(table.userId, table.kind, table.value)],
);
