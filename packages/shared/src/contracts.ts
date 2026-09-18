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
