import type { NewsAgentEvent } from "@news-agent/agent";

export class InMemoryRunEventStore {
  private readonly events = new Map<string, NewsAgentEvent[]>();
  private readonly listeners = new Map<string, Set<(event: NewsAgentEvent) => void>>();

  public publish(event: NewsAgentEvent): void {
    const history = this.events.get(event.runId) ?? [];
    history.push(event);
    if (history.length > 200) history.shift();
    this.events.set(event.runId, history);
    for (const listener of this.listeners.get(event.runId) ?? []) listener(event);
  }

  public list(runId: string): readonly NewsAgentEvent[] {
    return this.events.get(runId) ?? [];
  }

  public subscribe(runId: string, listener: (event: NewsAgentEvent) => void): () => void {
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }
}
