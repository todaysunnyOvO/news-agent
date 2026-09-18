export interface User {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  displayName: string;
}

export type DeliveryChannel = "web" | "email" | "webhook";

export interface Subscription {
  id: string;
  userId: string;
  topics: string[];
  keywords: string[];
  excludedKeywords: string[];
  languages: string[];
  sourceIds: string[];
  maxItems: number;
  scheduleCron: string;
  timezone: string;
  deliveryChannel: DeliveryChannel;
  enabled: boolean;
  pausedUntil: string | null;
  skipDates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSubscriptionInput {
  topics: string[];
  keywords: string[];
  excludedKeywords: string[];
  languages: string[];
  sourceIds: string[];
  maxItems: number;
  scheduleCron: string;
  timezone: string;
  deliveryChannel: DeliveryChannel;
  enabled: boolean;
  pausedUntil?: string | null;
  skipDates?: string[];
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface NewsSearchRequest {
  query: string;
  from?: string;
  to?: string;
  language?: string;
  sourceIds?: string[];
  limit?: number;
}

export interface NewsArticle {
  articleId: string;
  provider: string;
  sourceId: string;
  sourceName: string;
  title: string;
  canonicalUrl: string;
  publishedAt: string;
  retrievedAt: string;
  language: string;
  author?: string;
  eventTime?: string;
  summary?: string;
}

export interface FetchedArticle extends NewsArticle {
  content: string;
  contentHash: string;
  truncated: boolean;
}

export interface SaveBriefInput {
  userId: string;
  runId: string;
  title: string;
  overview: string;
  items: Array<{
    headline: string;
    summary: string;
    whyItMatters: string;
    topic: string;
    sourceArticleIds: string[];
  }>;
}

export interface SavedBrief {
  id: string;
  userId: string;
  runId: string;
  title: string;
  overview: string;
  localDate: string;
  markdownPath: string;
  createdAt: string;
}

export interface BriefDetail extends SavedBrief {
  items: Array<{
    id: string;
    headline: string;
    summary: string;
    whyItMatters: string;
    topic: string;
    rank: number;
    sources: NewsArticle[];
  }>;
}

export type BriefUsefulness = "useful" | "neutral" | "not_useful";
export type BriefLengthRating = "too_short" | "about_right" | "too_long";
export type BriefItemFeedbackType =
  | "useful"
  | "not_interested"
  | "already_known"
  | "repetitive";

export interface BriefFeedback {
  id: string;
  userId: string;
  briefId: string;
  usefulness: BriefUsefulness | null;
  lengthRating: BriefLengthRating | null;
  missedImportantNews: boolean;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertBriefFeedbackInput {
  usefulness?: BriefUsefulness | null;
  lengthRating?: BriefLengthRating | null;
  missedImportantNews?: boolean;
  comment?: string | null;
}

export interface BriefItemFeedback {
  id: string;
  userId: string;
  briefItemId: string;
  feedbackType: BriefItemFeedbackType;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BriefFeedbackSummary {
  briefFeedback: BriefFeedback | null;
  itemFeedback: BriefItemFeedback[];
}

export interface SavedItem {
  id: string;
  userId: string;
  briefItemId: string;
  briefId: string;
  headline: string;
  summary: string;
  topic: string;
  savedAt: string;
}

export type TrackedTopicStatus = "active" | "paused" | "closed";

export interface TrackedTopicQuery {
  headline: string;
  topic: string;
  sourceArticleIds: string[];
}

export interface TrackedTopic {
  id: string;
  userId: string;
  label: string;
  query: TrackedTopicQuery;
  status: TrackedTopicStatus;
  sourceBriefItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryJobStatus =
  | "pending"
  | "sending"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface DeliveryJob {
  id: string;
  briefId: string;
  runId: string;
  userId: string;
  channel: Exclude<DeliveryChannel, "web">;
  destinationHash: string;
  idempotencyKey: string;
  status: DeliveryJobStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryAttemptRecord {
  id: string;
  deliveryJobId: string;
  attemptNumber: number;
  status: "succeeded" | "failed";
  providerMessageId: string | null;
  errorCode: string | null;
  durationMs: number;
  createdAt: string;
}

export interface DeliveryJobDetail extends DeliveryJob {
  attempts: DeliveryAttemptRecord[];
}

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRunRecord {
  id: string;
  userId: string;
  trigger: string;
  status: AgentRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  model: string;
  toolCallCount: number;
  turnCount: number;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number;
  errorMessage: string | null;
  idempotencyKey: string | null;
}
