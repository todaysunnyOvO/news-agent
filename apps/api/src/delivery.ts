import { createHash } from "node:crypto";

import {
  BriefRepository,
  DeliveryRepository,
  SubscriptionRepository,
  type NewsDatabase,
} from "@news-agent/db";
import type { RunNewsAgentResult, StartedNewsAgentRun } from "@news-agent/agent";
import type { BriefDetail, DeliveryJob } from "@news-agent/shared";

import type { FeedbackActionSigner } from "./signed-actions.js";
import type { AgentRunController, RunNewsAgentInput } from "./types.js";

export interface DeliveryContent {
  subject: string;
  html: string;
  text: string;
  webhookBody: Record<string, unknown>;
}

export interface AdapterResult {
  providerMessageId?: string;
}

export interface DeliveryAdapter {
  readonly channel: "email" | "webhook";
  readonly destination: string;
  send(content: DeliveryContent, idempotencyKey: string): Promise<AdapterResult>;
}

export class DeliveryAdapterError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export class ResendEmailAdapter implements DeliveryAdapter {
  public readonly channel = "email" as const;

  public constructor(
    private readonly apiKey: string,
    private readonly from: string,
    public readonly destination: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  public async send(content: DeliveryContent, idempotencyKey: string): Promise<AdapterResult> {
    let response: Response;
    try {
      response = await this.request("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: [this.destination],
          subject: content.subject,
          html: content.html,
          text: content.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new DeliveryAdapterError(
        error instanceof Error ? error.message : "Resend request failed",
        "resend_network_error",
        true,
      );
    }
    const body = await response.json().catch(() => undefined) as
      | { id?: string; name?: string; message?: string }
      | undefined;
    if (!response.ok) {
      throw new DeliveryAdapterError(
        body?.message ?? `Resend returned status ${response.status}`,
        body?.name ?? `resend_http_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    if (!body?.id) throw new DeliveryAdapterError("Resend response did not include an email ID", "resend_invalid_response", true);
    return { providerMessageId: body.id };
  }
}

export class WebhookDeliveryAdapter implements DeliveryAdapter {
  public readonly channel = "webhook" as const;

  public constructor(
    public readonly destination: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (new URL(destination).protocol !== "https:") throw new Error("Delivery webhook must use HTTPS");
  }

  public async send(content: DeliveryContent, idempotencyKey: string): Promise<AdapterResult> {
    try {
      const response = await this.request(this.destination, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(content.webhookBody),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new DeliveryAdapterError(
          `Webhook returned status ${response.status}`,
          `webhook_http_${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      return {};
    } catch (error) {
      if (error instanceof DeliveryAdapterError) throw error;
      throw new DeliveryAdapterError(
        error instanceof Error ? error.message : "Webhook request failed",
        "webhook_network_error",
        true,
      );
    }
  }
}

export class DeliveryService {
  private readonly deliveryRepository: DeliveryRepository;
  private readonly briefRepository: BriefRepository;
  private readonly subscriptionRepository: SubscriptionRepository;
  private readonly adapters = new Map<string, DeliveryAdapter>();

  public constructor(
    db: NewsDatabase,
    adapters: DeliveryAdapter[],
    private readonly publicBaseUrl: string,
    private readonly signer: FeedbackActionSigner | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.deliveryRepository = new DeliveryRepository(db);
    this.briefRepository = new BriefRepository(db);
    this.subscriptionRepository = new SubscriptionRepository(db);
    for (const adapter of adapters) this.adapters.set(adapter.channel, adapter);
  }

  public async enqueueResult(result: RunNewsAgentResult): Promise<DeliveryJob | undefined> {
    if (result.status !== "succeeded" || !result.briefId) return undefined;
    return this.enqueueBrief(result.briefId);
  }

  public async enqueueBrief(briefId: string): Promise<DeliveryJob | undefined> {
    const brief = this.briefRepository.findDetailById(briefId);
    if (!brief) throw new Error("Brief not found");
    const subscription = this.subscriptionRepository.findByUserId(brief.userId);
    if (!subscription || subscription.deliveryChannel === "web") return undefined;
    const adapter = this.adapters.get(subscription.deliveryChannel);
    if (!adapter) throw new Error(`Delivery channel ${subscription.deliveryChannel} is not configured`);
    const job = this.deliveryRepository.createJob({
      briefId: brief.id,
      runId: brief.runId,
      userId: brief.userId,
      channel: adapter.channel,
      destinationHash: createHash("sha256").update(adapter.destination).digest("hex"),
      idempotencyKey: `brief:${brief.id}:${adapter.channel}`,
    });
    if (job.status === "pending" || job.status === "sending") return this.processJob(job.id);
    return job;
  }

  public async processDue(now = this.now()): Promise<void> {
    for (const job of this.deliveryRepository.listDue(now)) {
      await this.processJob(job.id).catch(() => undefined);
    }
  }

  public async retry(jobId: string): Promise<DeliveryJob | undefined> {
    const job = this.deliveryRepository.prepareRetry(jobId);
    return job ? this.processJob(job.id) : undefined;
  }

  public listByBriefId(briefId: string): DeliveryJob[] {
    return this.deliveryRepository.listByBriefId(briefId);
  }

  private async processJob(jobId: string): Promise<DeliveryJob> {
    const current = this.deliveryRepository.findById(jobId);
    if (!current) throw new Error("Delivery job not found");
    if (current.status === "succeeded" || current.status === "cancelled") return current;
    const adapter = this.adapters.get(current.channel);
    if (!adapter) throw new Error(`Delivery channel ${current.channel} is not configured`);
    const brief = this.briefRepository.findDetailById(current.briefId);
    if (!brief) throw new Error("Brief not found");
    this.deliveryRepository.markSending(current.id);
    const startedAt = Date.now();
    try {
      const result = await adapter.send(this.renderContent(brief), current.idempotencyKey);
      return this.deliveryRepository.recordAttempt(current.id, {
        success: true,
        durationMs: Date.now() - startedAt,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      });
    } catch (error) {
      const adapterError = error instanceof DeliveryAdapterError
        ? error
        : new DeliveryAdapterError("Delivery failed", "delivery_unknown_error", true);
      const nextAttemptAt = adapterError.retryable && current.attemptCount + 1 < 3
        ? new Date(this.now().getTime() + [60_000, 300_000][current.attemptCount]!).toISOString()
        : undefined;
      return this.deliveryRepository.recordAttempt(current.id, {
        success: false,
        durationMs: Date.now() - startedAt,
        errorCode: adapterError.code.slice(0, 200),
        ...(nextAttemptAt ? { nextAttemptAt } : {}),
      });
    }
  }

  private renderContent(brief: BriefDetail): DeliveryContent {
    const base = this.publicBaseUrl.replace(/\/$/, "");
    const expiresAt = this.now().getTime() + 7 * 24 * 60 * 60 * 1000;
    const itemHtml = brief.items.map((item) => {
      const actions = this.signer ? ([
        ["useful", "有用"],
        ["not_interested", "不感兴趣"],
        ["already_known", "已经知道"],
        ["repetitive", "重复/无新进展"],
      ] as const).map(([type, label]) => {
        const token = this.signer!.sign({ userId: brief.userId, briefId: brief.id, itemId: item.id, type, expiresAt });
        return `<a href="${base}/api/email-actions/feedback?token=${encodeURIComponent(token)}">${label}</a>`;
      }).join(" · ") : "";
      const sources = item.sources.map((source) => `<a href="${escapeHtml(source.canonicalUrl)}">${escapeHtml(source.sourceName)}</a>`).join("、");
      return `<section><h2>${item.rank}. ${escapeHtml(item.headline)}</h2><p>${escapeHtml(item.summary)}</p><p><strong>为什么重要：</strong>${escapeHtml(item.whyItMatters)}</p><p>来源：${sources}</p>${actions ? `<p>${actions}</p>` : ""}</section>`;
    }).join("");
    const textItems = brief.items.map((item) => `${item.rank}. ${item.headline}\n${item.summary}\n为什么重要：${item.whyItMatters}\n${item.sources.map((source) => source.canonicalUrl).join("\n")}`).join("\n\n");
    return {
      subject: brief.title,
      html: `<!doctype html><html><body><h1>${escapeHtml(brief.title)}</h1><p>${escapeHtml(brief.overview)}</p>${itemHtml}<p><a href="${base}/?brief=${encodeURIComponent(brief.id)}">打开完整简报</a></p></body></html>`,
      text: `${brief.title}\n\n${brief.overview}\n\n${textItems}\n\n打开完整简报：${base}/?brief=${brief.id}`,
      webhookBody: { type: "news_brief_ready", runId: brief.runId, briefId: brief.id },
    };
  }
}

export class DeliveryWorker {
  private timer: NodeJS.Timeout | undefined;

  public constructor(private readonly delivery: DeliveryService) {}

  public start(intervalMs = 30_000): void {
    if (this.timer) return;
    void this.delivery.processDue();
    this.timer = setInterval(() => void this.delivery.processDue(), intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

export class DeliveringAgentController implements AgentRunController {
  public constructor(
    private readonly controller: AgentRunController,
    private readonly delivery: DeliveryService,
  ) {}

  public start(input: RunNewsAgentInput): StartedNewsAgentRun {
    const started = this.controller.start(input);
    return {
      runId: started.runId,
      completion: started.completion.then(async (result) => {
        await this.delivery.enqueueResult(result).catch(() => undefined);
        return result;
      }),
    };
  }

  public cancel(runId: string): Promise<boolean> {
    return this.controller.cancel(runId);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}
