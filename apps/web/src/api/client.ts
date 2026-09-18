import type {
  AgentRunRecord,
  BriefDetail,
  CreateUserInput,
  SavedBrief,
  Subscription,
  UpsertSubscriptionInput,
  User,
} from "@news-agent/shared";

export interface RunEvent {
  type: string;
  runId: string;
  timestamp: string;
  delta?: string;
  toolName?: string;
  success?: boolean;
  briefId?: string;
  status?: string;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: string }
      | undefined;
    throw new Error(body?.message ?? `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export const api = {
  createUser(input: CreateUserInput): Promise<User> {
    return request<User>("/api/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  getUser(userId: string): Promise<User> {
    return request<User>(`/api/users/${userId}`);
  },

  getSubscription(userId: string): Promise<Subscription> {
    return request<Subscription>(`/api/users/${userId}/subscription`);
  },

  saveSubscription(userId: string, input: UpsertSubscriptionInput): Promise<Subscription> {
    return request<Subscription>(`/api/users/${userId}/subscription`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },

  startRun(userId: string): Promise<{ runId: string; status: string }> {
    return request(`/api/users/${userId}/runs`, { method: "POST", body: "{}" });
  },

  getRun(runId: string): Promise<AgentRunRecord> {
    return request(`/api/runs/${runId}`);
  },

  cancelRun(runId: string): Promise<{ runId: string; cancelled: boolean }> {
    return request(`/api/runs/${runId}/cancel`, { method: "POST", body: "{}" });
  },

  listBriefs(userId: string): Promise<SavedBrief[]> {
    return request(`/api/users/${userId}/briefs`);
  },

  getBrief(briefId: string): Promise<BriefDetail> {
    return request(`/api/briefs/${briefId}`);
  },

  watchRun(runId: string, onEvent: (event: RunEvent) => void, onError: () => void): () => void {
    const source = new EventSource(`/api/runs/${runId}/events`);
    const eventTypes = ["run_started", "agent_text_delta", "tool_started", "tool_finished", "brief_saved", "run_failed", "run_finished"];
    for (const type of eventTypes) source.addEventListener(type, (event) => onEvent(JSON.parse((event as MessageEvent<string>).data) as RunEvent));
    source.onerror = onError;
    return () => source.close();
  },
};
