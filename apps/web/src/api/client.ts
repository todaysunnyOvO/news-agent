import type {
  AgentRunRecord,
  BriefDetail,
  BriefFeedback,
  BriefFeedbackSummary,
  BriefItemFeedback,
  BriefItemFeedbackType,
  CreateUserInput,
  DeliveryJob,
  DeliveryJobDetail,
  InferredPreference,
  InferredPreferenceStatus,
  PersonalizationProfile,
  SavedBrief,
  SavedItem,
  Subscription,
  UpsertSubscriptionInput,
  UpsertBriefFeedbackInput,
  TrackedTopic,
  TrackedTopicStatus,
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

  getPreferenceProfile(userId: string): Promise<PersonalizationProfile> {
    return request(`/api/users/${userId}/preference-profile`);
  },

  setPersonalizationEnabled(userId: string, enabled: boolean): Promise<Subscription> {
    return request(`/api/users/${userId}/personalization`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
  },

  updateInferredPreference(
    preferenceId: string,
    userId: string,
    input: { status?: InferredPreferenceStatus; weight?: number },
  ): Promise<InferredPreference> {
    return request(`/api/inferred-preferences/${preferenceId}`, {
      method: "PATCH",
      body: JSON.stringify({ userId, ...input }),
    });
  },

  deleteInferredPreference(preferenceId: string, userId: string): Promise<{ removed: boolean }> {
    return request(`/api/inferred-preferences/${preferenceId}`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
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

  skipToday(userId: string): Promise<Subscription> {
    return request(`/api/users/${userId}/subscription/skip-today`, { method: "POST", body: "{}" });
  },

  listDeliveries(briefId: string): Promise<DeliveryJobDetail[]> {
    return request(`/api/briefs/${briefId}/deliveries`);
  },

  deliverBrief(briefId: string, userId: string): Promise<DeliveryJob> {
    return request(`/api/briefs/${briefId}/deliver`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  retryDelivery(deliveryId: string, userId: string): Promise<DeliveryJob> {
    return request(`/api/deliveries/${deliveryId}/retry`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  getBriefFeedback(briefId: string, userId: string): Promise<BriefFeedbackSummary> {
    return request(`/api/briefs/${briefId}/feedback?userId=${encodeURIComponent(userId)}`);
  },

  saveBriefFeedback(
    briefId: string,
    userId: string,
    input: UpsertBriefFeedbackInput,
  ): Promise<BriefFeedback> {
    return request(`/api/briefs/${briefId}/feedback`, {
      method: "PUT",
      body: JSON.stringify({ userId, ...input }),
    });
  },

  setItemFeedback(
    itemId: string,
    userId: string,
    type: BriefItemFeedbackType,
    active: boolean,
  ): Promise<BriefItemFeedback> {
    return request(`/api/brief-items/${itemId}/feedback/${type}`, {
      method: active ? "PUT" : "DELETE",
      body: JSON.stringify({ userId }),
    });
  },

  saveItem(itemId: string, userId: string): Promise<SavedItem> {
    return request(`/api/brief-items/${itemId}/saved`, {
      method: "PUT",
      body: JSON.stringify({ userId }),
    });
  },

  removeSavedItem(itemId: string, userId: string): Promise<{ removed: boolean }> {
    return request(`/api/brief-items/${itemId}/saved`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    });
  },

  listSavedItems(userId: string): Promise<SavedItem[]> {
    return request(`/api/users/${userId}/saved-items`);
  },

  trackItem(itemId: string, userId: string): Promise<TrackedTopic> {
    return request(`/api/brief-items/${itemId}/tracking`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  },

  listTrackedTopics(userId: string): Promise<TrackedTopic[]> {
    return request(`/api/users/${userId}/tracked-topics`);
  },

  updateTrackedTopic(
    trackingId: string,
    userId: string,
    input: { label?: string; status?: TrackedTopicStatus },
  ): Promise<TrackedTopic> {
    return request(`/api/tracked-topics/${trackingId}`, {
      method: "PATCH",
      body: JSON.stringify({ userId, ...input }),
    });
  },

  watchRun(runId: string, onEvent: (event: RunEvent) => void, onError: () => void): () => void {
    const source = new EventSource(`/api/runs/${runId}/events`);
    const eventTypes = ["run_started", "agent_text_delta", "tool_started", "tool_finished", "brief_saved", "run_failed", "run_finished"];
    for (const type of eventTypes) source.addEventListener(type, (event) => onEvent(JSON.parse((event as MessageEvent<string>).data) as RunEvent));
    source.onerror = onError;
    return () => source.close();
  },
};
