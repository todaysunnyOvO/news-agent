import type { AgentRunRepository, BriefRepository, DeliveryRepository, FeedbackRepository, LibraryRepository, SubscriptionRepository, UserRepository } from "@news-agent/db";
import type { NewsAgentEvent, RunNewsAgentInput, RunNewsAgentResult, StartedNewsAgentRun } from "@news-agent/agent";

export interface AppRepositories {
  users: UserRepository;
  subscriptions: SubscriptionRepository;
  runs: AgentRunRepository;
  briefs: BriefRepository;
  feedback: FeedbackRepository;
  library: LibraryRepository;
  deliveries: DeliveryRepository;
}

export interface AgentRunController {
  start(input: RunNewsAgentInput): StartedNewsAgentRun;
  cancel(runId: string): Promise<boolean>;
}

export interface RunEventStore {
  publish(event: NewsAgentEvent): void;
  list(runId: string): readonly NewsAgentEvent[];
  subscribe(runId: string, listener: (event: NewsAgentEvent) => void): () => void;
}

export type { NewsAgentEvent, RunNewsAgentInput, RunNewsAgentResult };
