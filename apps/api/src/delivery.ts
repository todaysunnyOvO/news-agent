import { DeliveryRepository, type NewsDatabase } from "@news-agent/db";
import type { RunNewsAgentResult, StartedNewsAgentRun } from "@news-agent/agent";

import type { AgentRunController, RunNewsAgentInput } from "./types.js";

export class WebhookDeliveryService {
  private readonly repository: DeliveryRepository;

  public constructor(
    db: NewsDatabase,
    private readonly webhookUrl: string | undefined,
    private readonly request: typeof fetch = fetch,
  ) {
    this.repository = new DeliveryRepository(db);
    if (webhookUrl && new URL(webhookUrl).protocol !== "https:") throw new Error("Delivery webhook must use HTTPS");
  }

  public async deliver(result: RunNewsAgentResult): Promise<void> {
    if (!this.webhookUrl || result.status !== "succeeded" || !result.briefId) return;
    if (this.repository.find(result.runId, "webhook")?.status === "delivered") return;
    let lastError = "Webhook delivery failed";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.repository.record(result.runId, "webhook", "pending");
      try {
        const response = await this.request(this.webhookUrl, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "news_brief_ready", runId: result.runId, briefId: result.briefId }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Webhook returned status ${response.status}`);
        this.repository.record(result.runId, "webhook", "delivered", undefined, false);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message.slice(0, 300) : "Webhook request failed";
        this.repository.record(result.runId, "webhook", "failed", lastError, false);
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
      }
    }
    throw new Error(lastError);
  }
}

export class DeliveringAgentController implements AgentRunController {
  public constructor(
    private readonly controller: AgentRunController,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  public start(input: RunNewsAgentInput): StartedNewsAgentRun {
    const started = this.controller.start(input);
    return {
      runId: started.runId,
      completion: started.completion.then(async (result) => {
        await this.delivery.deliver(result).catch(() => undefined);
        return result;
      }),
    };
  }

  public cancel(runId: string): Promise<boolean> {
    return this.controller.cancel(runId);
  }
}
