import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  AgentRunRepository,
  BriefRepository,
  SubscriptionRepository,
  type AgentRunMetrics,
  type NewsDatabase,
} from "@news-agent/db";
import type { NewsService } from "@news-agent/news";
import { createBaseToolset, createNewsToolset } from "@news-agent/tools";

import { mapSessionEvent, type EventMapperState, type NewsAgentEventListener } from "./events.js";
import { adaptTools } from "./pi-adapter.js";
import { createNewsAgentPrompt, NEWS_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";

export interface NewsAgentBudgets {
  maxDurationMs: number;
  maxTurns: number;
  maxToolCalls: number;
}

export const DEFAULT_NEWS_AGENT_BUDGETS: Readonly<NewsAgentBudgets> = {
  maxDurationMs: 180_000,
  maxTurns: 12,
  maxToolCalls: 30,
};

export interface NewsAgentServiceOptions {
  db: NewsDatabase;
  newsService: NewsService;
  dataRoot: string;
  model: Model<Api>;
  modelRuntime: ModelRuntime;
  budgets?: Partial<NewsAgentBudgets>;
}

export interface RunNewsAgentInput {
  userId: string;
  trigger?: "manual" | "scheduled";
  idempotencyKey?: string;
  onEvent?: NewsAgentEventListener;
}

export interface RunNewsAgentResult {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  briefId?: string;
  finalText: string;
  toolCallCount: number;
  turnCount: number;
  error?: string;
}

interface ActiveRun {
  session: AgentSession | undefined;
  cancelled: boolean;
}

export interface StartedNewsAgentRun {
  runId: string;
  completion: Promise<RunNewsAgentResult>;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown agent error";
  return message
    .replaceAll(/((?:api[_-]?key|authorization|token)\s*[:=])\s*\S+/gi, "$1 [redacted]")
    .slice(0, 500);
}

export class NewsAgentService {
  private readonly runs: AgentRunRepository;
  private readonly briefs: BriefRepository;
  private readonly subscriptions: SubscriptionRepository;
  private readonly budgets: NewsAgentBudgets;
  private readonly activeRuns = new Map<string, ActiveRun>();

  public constructor(private readonly options: NewsAgentServiceOptions) {
    this.runs = new AgentRunRepository(options.db);
    this.briefs = new BriefRepository(options.db);
    this.subscriptions = new SubscriptionRepository(options.db);
    this.budgets = { ...DEFAULT_NEWS_AGENT_BUDGETS, ...options.budgets };
    if (this.budgets.maxDurationMs < 1 || this.budgets.maxTurns < 1 || this.budgets.maxToolCalls < 1) {
      throw new Error("Agent budgets must be positive integers");
    }
  }

  public async cancel(runId: string): Promise<boolean> {
    const active = this.activeRuns.get(runId);
    if (!active) return false;
    active.cancelled = true;
    await active.session?.abort();
    return true;
  }

  public start(input: RunNewsAgentInput): StartedNewsAgentRun {
    const trigger = input.trigger ?? "manual";
    const runId = this.runs.create(
      input.userId,
      `${this.options.model.provider}/${this.options.model.id}`,
      trigger,
      input.idempotencyKey,
    );
    this.activeRuns.set(runId, { session: undefined, cancelled: false });
    return {
      runId,
      completion: Promise.resolve().then(() => this.execute(input, runId)),
    };
  }

  public async run(input: RunNewsAgentInput): Promise<RunNewsAgentResult> {
    return this.start(input).completion;
  }

  private async execute(input: RunNewsAgentInput, runId: string): Promise<RunNewsAgentResult> {
    const startedAt = performance.now();
    const emit = (event: Parameters<NonNullable<RunNewsAgentInput["onEvent"]>>[0]): void => input.onEvent?.(event);
    this.runs.markRunning(runId);
    emit({ type: "run_started", runId, timestamp: new Date().toISOString() });

    let session: AgentSession | undefined;
    let toolCallCount = 0;
    let turnCount = 0;
    let budgetError: string | undefined;
    let timeout: NodeJS.Timeout | undefined;
    const eventState: EventMapperState = { toolStartedAt: new Map() };

    try {
      const active = this.activeRuns.get(runId);
      if (!active || active.cancelled) {
        return this.finish(runId, "cancelled", "", 0, 0, undefined, undefined, emit, this.collectMetrics(undefined, startedAt, 0));
      }
      const subscription = this.subscriptions.findByUserId(input.userId);
      if (!subscription) throw new Error("User subscription not found");
      const base = await createBaseToolset({ dataRoot: this.options.dataRoot, userId: input.userId });
      const domainTools = createNewsToolset({
        db: this.options.db,
        newsService: this.options.newsService,
        workspace: base.workspace,
        userId: input.userId,
        timezone: subscription.timezone,
      });

      const agentDir = join(this.options.dataRoot, ".pi-agent");
      await mkdir(agentDir, { recursive: true });
      const settingsManager = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: base.workspace.workspaceRoot,
        agentDir,
        settingsManager,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt: NEWS_AGENT_SYSTEM_PROMPT,
      });
      await resourceLoader.reload();
      ({ session } = await createAgentSession({
        cwd: base.workspace.workspaceRoot,
        agentDir,
        model: this.options.model,
        modelRuntime: this.options.modelRuntime,
        noTools: "builtin",
        customTools: adaptTools([...base.tools, ...domainTools]),
        resourceLoader,
        sessionManager: SessionManager.inMemory(base.workspace.workspaceRoot),
        settingsManager,
      }));

      active.session = session;
      session.agent.shouldStopAfterTurn = () => {
        if (turnCount >= this.budgets.maxTurns) {
          budgetError = `Turn budget reached (${this.budgets.maxTurns})`;
          return true;
        }
        return false;
      };

      const unsubscribe = session.subscribe((event) => {
        if (event.type === "turn_start") {
          if (turnCount >= this.budgets.maxTurns) {
            budgetError = `Turn budget exceeded (${this.budgets.maxTurns})`;
            void session?.abort();
          } else {
            turnCount += 1;
          }
        }
        if (event.type === "tool_execution_start") {
          if (toolCallCount >= this.budgets.maxToolCalls) {
            budgetError = `Tool-call budget exceeded (${this.budgets.maxToolCalls})`;
            void session?.abort();
          } else {
            toolCallCount += 1;
          }
        }
        for (const mapped of mapSessionEvent(runId, event, eventState)) emit(mapped);
      });
      timeout = setTimeout(() => {
        budgetError = `Duration budget exceeded (${this.budgets.maxDurationMs} ms)`;
        void session?.abort();
      }, this.budgets.maxDurationMs);

      try {
        await session.prompt(createNewsAgentPrompt(input.userId, runId), {
          expandPromptTemplates: false,
          source: "rpc",
        });
        await session.waitForIdle();
      } finally {
        unsubscribe();
      }

      const saved = this.briefs.findByRunId(runId);
      const finalText = session.getLastAssistantText() ?? "";
      if (active.cancelled) {
        return this.finish(runId, "cancelled", finalText, toolCallCount, turnCount, undefined, undefined, emit, this.collectMetrics(session, startedAt, turnCount));
      }
      if (!saved) {
        throw new Error(budgetError ?? session.state.errorMessage ?? "Agent ended without saving a brief");
      }
      return this.finish(runId, "succeeded", finalText, toolCallCount, turnCount, saved.id, undefined, emit, this.collectMetrics(session, startedAt, turnCount));
    } catch (error) {
      const message = safeError(error);
      emit({ type: "run_failed", runId, timestamp: new Date().toISOString(), error: message });
      return this.finish(runId, "failed", session?.getLastAssistantText() ?? "", toolCallCount, turnCount, undefined, message, emit, this.collectMetrics(session, startedAt, turnCount));
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeRuns.delete(runId);
      session?.dispose();
    }
  }

  private finish(
    runId: string,
    status: RunNewsAgentResult["status"],
    finalText: string,
    toolCallCount: number,
    turnCount: number,
    briefId: string | undefined,
    error: string | undefined,
    emit: NewsAgentEventListener,
    metrics: AgentRunMetrics,
  ): RunNewsAgentResult {
    this.runs.finish(runId, status, toolCallCount, error, metrics);
    emit({ type: "run_finished", runId, timestamp: new Date().toISOString(), status, toolCallCount, turnCount });
    return {
      runId,
      status,
      finalText,
      toolCallCount,
      turnCount,
      ...(briefId ? { briefId } : {}),
      ...(error ? { error } : {}),
    };
  }

  private collectMetrics(session: AgentSession | undefined, startedAt: number, turnCount: number): AgentRunMetrics {
    const stats = session?.getSessionStats();
    return {
      turnCount,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      inputTokens: stats?.tokens.input ?? 0,
      outputTokens: stats?.tokens.output ?? 0,
      costUsd: stats?.cost ?? 0,
    };
  }
}
