import { type FormEvent, useEffect, useRef, useState } from "react";

import type {
  AgentRunRecord,
  BriefDetail,
  BriefFeedbackSummary,
  BriefItemFeedbackType,
  BriefLengthRating,
  BriefUsefulness,
  DeliveryJob,
  DeliveryJobDetail,
  InferredPreference,
  MetricsSnapshot,
  PersonalizationProfile,
  SavedBrief,
  SavedItem,
  Subscription,
  TrackedTopic,
  UpsertBriefFeedbackInput,
  UpsertSubscriptionInput,
  User,
} from "@news-agent/shared";

import { api, type RunEvent } from "./api/client";
import { deliveryFailureMessage, deliveryStateCopy, resolveDeliveryViewState } from "./delivery-display";
import { hasActiveNegativeFeedback, negativeFeedbackOptions } from "./feedback-display";
import { isSettingsArea, primaryNavigation, type PrimaryNavigationId } from "./navigation";
import { clampOnboardingStep, onboardingStepCount, onboardingSteps } from "./onboarding";
import { hasUnsavedSubscriptionChanges, toSubscriptionDraft } from "./subscription-state";
import { resolveTodayViewState } from "./today-state";

const defaultSubscription: UpsertSubscriptionInput = {
  topics: ["大模型", "AI Agent"], keywords: ["OpenAI", "Claude", "Pi"], excludedKeywords: [],
  languages: ["zh-CN", "en"], sourceIds: [], maxItems: 5, scheduleCron: "0 8 * * *",
  timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true,
  pausedUntil: null, skipDates: [],
  personalizationEnabled: true,
};

const emptyBriefFeedback: UpsertBriefFeedbackInput = {
  usefulness: null, lengthRating: null, missedImportantNews: false, comment: "",
};

function splitList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function localDateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function App() {
  const [user, setUser] = useState<User>();
  const [displayName, setDisplayName] = useState("");
  const [draftSubscription, setDraftSubscription] = useState<UpsertSubscriptionInput>(defaultSubscription);
  const [savedSubscription, setSavedSubscription] = useState<Subscription>();
  const [status, setStatus] = useState("请先创建一个本地演示身份。");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"today" | "onboarding" | "settings" | "library" | "personalization" | "quality" | "run">("today");
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [run, setRun] = useState<AgentRunRecord>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [briefs, setBriefs] = useState<SavedBrief[]>([]);
  const [brief, setBrief] = useState<BriefDetail>();
  const [feedback, setFeedback] = useState<BriefFeedbackSummary>();
  const [briefFeedbackDraft, setBriefFeedbackDraft] = useState<UpsertBriefFeedbackInput>(emptyBriefFeedback);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [trackedTopics, setTrackedTopics] = useState<TrackedTopic[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryJobDetail[]>([]);
  const [profile, setProfile] = useState<PersonalizationProfile>();
  const [metrics, setMetrics] = useState<MetricsSnapshot>();
  const [saveMessage, setSaveMessage] = useState<string>();
  const [skipBusy, setSkipBusy] = useState(false);
  const [skipMessage, setSkipMessage] = useState<string>();
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState<string>();
  const [openNegativeFeedbackItemId, setOpenNegativeFeedbackItemId] = useState<string>();
  const [pendingItemActions, setPendingItemActions] = useState<Record<string, string>>({});
  const [itemActionMessages, setItemActionMessages] = useState<Record<string, { tone: "success" | "error" | "pending"; text: string }>>({});
  const [briefFeedbackBusy, setBriefFeedbackBusy] = useState(false);
  const [briefFeedbackMessage, setBriefFeedbackMessage] = useState<string>();
  const closeEvents = useRef<() => void>(() => undefined);
  const subscriptionDirty = hasUnsavedSubscriptionChanges(draftSubscription, savedSubscription);

  async function loadToday(userId: string): Promise<void> {
    const history = await api.listBriefs(userId);
    setBriefs(history);
    if (history[0]) await openBrief(history[0].id, userId, "today");
    else {
      setBrief(undefined);
      setFeedback(undefined);
      setDeliveries([]);
      setView("today");
    }
  }

  async function loadLibrary(userId: string): Promise<void> {
    const [saved, tracked] = await Promise.all([api.listSavedItems(userId), api.listTrackedTopics(userId)]);
    setSavedItems(saved);
    setTrackedTopics(tracked);
  }

  async function loadProfile(userId: string): Promise<void> {
    setProfile(await api.getPreferenceProfile(userId));
  }

  async function loadMetrics(userId: string): Promise<void> {
    setMetrics(await api.getMetrics(userId));
  }

  useEffect(() => {
    const savedUserId = localStorage.getItem("news-agent-user-id");
    if (!savedUserId) return;
    void (async () => {
      try {
        const restored = await api.getUser(savedUserId);
        setUser(restored);
        setStatus(`欢迎回来，${restored.displayName}`);
        let restoredSubscription: Subscription | undefined;
        await Promise.all([
          api.getSubscription(savedUserId).then((subscription) => {
            restoredSubscription = subscription;
            setSavedSubscription(subscription);
            setDraftSubscription(toSubscriptionDraft(subscription));
          }).catch(() => setStatus("身份已恢复，请完成首次订阅设置。")),
          loadToday(savedUserId),
          loadLibrary(savedUserId),
          loadProfile(savedUserId).catch(() => undefined),
        ]);
        if (!restoredSubscription) {
          setOnboardingStep(1);
          setView("onboarding");
        }
        const linkedBrief = new URLSearchParams(window.location.search).get("brief");
        if (linkedBrief) await openBrief(linkedBrief, savedUserId);
      } catch { localStorage.removeItem("news-agent-user-id"); }
    })();
    return () => closeEvents.current();
  }, []);

  useEffect(() => {
    if (!user || !subscriptionDirty) return;
    const warnAboutUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warnAboutUnsavedChanges);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedChanges);
  }, [subscriptionDirty, user]);

  async function createIdentity(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createUser({ displayName });
      localStorage.setItem("news-agent-user-id", created.id);
      setSavedSubscription(undefined);
      setDraftSubscription(defaultSubscription);
      setOnboardingStep(1);
      setView("onboarding");
      setUser(created); setStatus("身份已创建，用三个步骤完成首次设置。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "创建身份失败"); }
    finally { setBusy(false); }
  }

  async function savePreferences(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setSaveMessage("正在保存订阅偏好…");
    try {
      const updated = await api.saveSubscription(user.id, draftSubscription);
      setSavedSubscription(updated);
      setDraftSubscription(toSubscriptionDraft(updated));
      setSkipMessage(undefined);
      setDeliveryMessage(undefined);
      setSaveMessage("订阅偏好已保存，新的推送渠道现在生效。");
      setStatus("订阅偏好已保存。");
    }
    catch (error) {
      const message = error instanceof Error ? error.message : "保存订阅失败";
      setSaveMessage(`保存失败：${message}`);
      setStatus(message);
    }
    finally { setBusy(false); }
  }

  async function completeOnboarding(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!user) return;
    if (!draftSubscription.topics.length && !draftSubscription.keywords.length) {
      setStatus("请至少填写一个关注话题或关键词。");
      setOnboardingStep(1);
      return;
    }
    setBusy(true);
    setStatus("正在保存首次设置…");
    try {
      const updated = await api.saveSubscription(user.id, draftSubscription);
      setSavedSubscription(updated);
      setDraftSubscription(toSubscriptionDraft(updated));
      setSaveMessage("订阅偏好已保存，正在生成第一份简报。");
      setView("today");
      await startRun();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存首次设置失败";
      setStatus(message);
      setSaveMessage(`保存失败：${message}`);
      setBusy(false);
    }
  }

  async function togglePersonalization(enabled: boolean): Promise<void> {
    if (!user) return;
    try {
      const updated = await api.setPersonalizationEnabled(user.id, enabled);
      setSavedSubscription(updated);
      setDraftSubscription((current) => ({
        ...current,
        personalizationEnabled: updated.personalizationEnabled,
      }));
      await loadProfile(user.id);
      setStatus(enabled ? "个性化排序已启用。" : "个性化排序已暂停，显式订阅偏好仍然有效。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "更新个性化设置失败"); }
  }

  async function updatePreference(preference: InferredPreference, input: { status?: "accepted" | "dismissed"; weight?: number }): Promise<void> {
    if (!user) return;
    try {
      await api.updateInferredPreference(preference.id, user.id, input);
      await loadProfile(user.id);
      setStatus(input.status === "accepted" ? "已接受推断偏好。" : input.status === "dismissed" ? "已忽略推断偏好。" : "偏好权重已更新。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "更新推断偏好失败"); }
  }

  async function deletePreference(preferenceId: string): Promise<void> {
    if (!user) return;
    try {
      await api.deleteInferredPreference(preferenceId, user.id);
      await loadProfile(user.id);
      setStatus("推断偏好已删除。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "删除推断偏好失败"); }
  }

  async function startRun(): Promise<void> {
    if (!user) return;
    if (view === "settings" && subscriptionDirty) {
      setSaveMessage("请先保存订阅设置，再开始生成简报。");
      setStatus("订阅设置仍有未保存修改，尚未开始生成。");
      return;
    }
    setBusy(true); setEvents([]); setView("today");
    try {
      const started = await api.startRun(user.id);
      setStatus("Agent 正在生成简报…");
      closeEvents.current();
      closeEvents.current = api.watchRun(started.runId, (next) => {
        setEvents((current) => [...current, next]);
        if (next.type === "run_finished") {
          closeEvents.current();
          void api.getRun(started.runId).then((record) => {
            setRun(record); setBusy(false);
            setStatus(record.status === "succeeded" ? "简报生成完成。" : `运行已${record.status}。`);
          });
          if (next.status === "succeeded") setTimeout(() => void loadLatestBrief(user.id), 50);
          else void loadToday(user.id);
        }
      }, () => setStatus("事件连接已结束，可刷新运行状态。"));
      setRun(await api.getRun(started.runId));
    } catch (error) { setBusy(false); setStatus(error instanceof Error ? error.message : "启动失败"); }
  }

  async function loadLatestBrief(userId: string): Promise<void> {
    const history = await api.listBriefs(userId);
    setBriefs(history);
    if (history[0]) await openBrief(history[0].id, userId);
  }

  async function openBrief(id: string, explicitUserId?: string, targetView: typeof view = "today"): Promise<void> {
    const userId = explicitUserId ?? user?.id;
    if (!userId) return;
    const [detail, currentFeedback, currentDeliveries] = await Promise.all([
      api.getBrief(id), api.getBriefFeedback(id, userId), api.listDeliveries(id),
    ]);
    setBrief(detail); setFeedback(currentFeedback);
    setDeliveries(currentDeliveries);
    setDeliveryMessage(undefined);
    setOpenNegativeFeedbackItemId(undefined);
    setPendingItemActions({});
    setItemActionMessages({});
    setBriefFeedbackMessage(undefined);
    setBriefFeedbackDraft({
      usefulness: currentFeedback.briefFeedback?.usefulness ?? null,
      lengthRating: currentFeedback.briefFeedback?.lengthRating ?? null,
      missedImportantNews: currentFeedback.briefFeedback?.missedImportantNews ?? false,
      comment: currentFeedback.briefFeedback?.comment ?? "",
    });
    setView(targetView);
  }

  async function cancelRun(): Promise<void> {
    if (!run) return;
    const result = await api.cancelRun(run.id);
    if (result.cancelled) setStatus("已请求取消运行。");
  }

  function isFeedbackActive(itemId: string, type: BriefItemFeedbackType): boolean {
    return Boolean(feedback?.itemFeedback.some((item) => item.briefItemId === itemId && item.feedbackType === type && item.active));
  }

  async function toggleItemFeedback(itemId: string, type: BriefItemFeedbackType): Promise<void> {
    if (!user || !brief || pendingItemActions[itemId]) return;
    const active = !isFeedbackActive(itemId, type);
    setPendingItemActions((current) => ({ ...current, [itemId]: `feedback:${type}` }));
    setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "pending", text: "正在保存反馈…" } }));
    try {
      await api.setItemFeedback(itemId, user.id, type, active);
      setFeedback(await api.getBriefFeedback(brief.id, user.id));
      const message = type === "useful"
        ? active ? "已标记为有帮助。" : "已撤回有帮助反馈。"
        : active ? "不喜欢的原因已记录。" : "该原因已撤回。";
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "success", text: message } }));
      setStatus(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存反馈失败";
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "error", text: `保存失败：${message}` } }));
      setStatus(message);
    } finally {
      setPendingItemActions((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    }
  }

  async function saveOverallFeedback(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!user || !brief || briefFeedbackBusy) return;
    setBriefFeedbackBusy(true);
    setBriefFeedbackMessage("正在保存本期评价…");
    try {
      await api.saveBriefFeedback(brief.id, user.id, briefFeedbackDraft);
      setFeedback(await api.getBriefFeedback(brief.id, user.id));
      setBriefFeedbackMessage("本期评价已保存。");
      setStatus("本期简报评价已保存。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存简报评价失败";
      setBriefFeedbackMessage(`保存失败：${message}`);
      setStatus(message);
    } finally { setBriefFeedbackBusy(false); }
  }

  async function toggleSavedItem(itemId: string): Promise<void> {
    if (!user || pendingItemActions[itemId]) return;
    const saved = savedItems.some((item) => item.briefItemId === itemId);
    setPendingItemActions((current) => ({ ...current, [itemId]: "save" }));
    setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "pending", text: saved ? "正在取消收藏…" : "正在收藏…" } }));
    try {
      if (saved) await api.removeSavedItem(itemId, user.id); else await api.saveItem(itemId, user.id);
      await loadLibrary(user.id);
      const message = saved ? "已取消收藏。" : "已收藏，可以继续追踪后续进展。";
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "success", text: message } }));
      setStatus(saved ? "已取消收藏。" : "已收藏。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "收藏操作失败";
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "error", text: `操作失败：${message}` } }));
      setStatus(message);
    } finally {
      setPendingItemActions((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    }
  }

  async function trackItem(itemId: string): Promise<void> {
    if (!user || pendingItemActions[itemId]) return;
    setPendingItemActions((current) => ({ ...current, [itemId]: "track" }));
    setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "pending", text: "正在加入持续追踪…" } }));
    try {
      await api.trackItem(itemId, user.id);
      await loadLibrary(user.id);
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "success", text: "已加入持续追踪。" } }));
      setStatus("已加入持续追踪。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "加入追踪失败";
      setItemActionMessages((current) => ({ ...current, [itemId]: { tone: "error", text: `操作失败：${message}` } }));
      setStatus(message);
    } finally {
      setPendingItemActions((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
    }
  }

  async function updateTracking(topic: TrackedTopic, nextStatus: "active" | "paused" | "closed") {
    if (!user) return;
    await api.updateTrackedTopic(topic.id, user.id, { status: nextStatus });
    await loadLibrary(user.id);
    setStatus(nextStatus === "closed" ? "已停止追踪。" : nextStatus === "paused" ? "已暂停追踪。" : "已恢复追踪。");
  }

  function updateSchedule(mode: "daily" | "weekdays", time: string): void {
    const [hour = "8", minute = "0"] = time.split(":");
    setDraftSubscription({ ...draftSubscription, scheduleCron: `${Number(minute)} ${Number(hour)} * * ${mode === "weekdays" ? "1-5" : "*"}` });
  }

  function scheduleTime(): string {
    const [minute = "0", hour = "8"] = draftSubscription.scheduleCron.split(/\s+/);
    return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  function navigateTo(nextView: typeof view): void {
    if (view === "settings" && nextView !== "settings" && subscriptionDirty) {
      setStatus("订阅设置有未保存修改；这些修改尚未应用到生成和投递。");
    }
    setView(nextView);
  }

  function navigatePrimary(nextView: PrimaryNavigationId): void {
    if (!user) return;
    navigateTo(nextView);
    if (nextView === "today") void loadToday(user.id);
    if (nextView === "library") void loadLibrary(user.id);
  }

  async function skipToday(): Promise<void> {
    if (!user) return;
    if (!savedSubscription) {
      setSkipMessage("请先保存订阅偏好，再跳过今天的自动简报。");
      return;
    }
    setSkipBusy(true);
    setSkipMessage("正在更新今天的计划…");
    try {
      const updated = await api.skipToday(user.id);
      setSavedSubscription(updated);
      setDraftSubscription((current) => ({ ...current, skipDates: [...updated.skipDates] }));
      setSkipMessage("今天的自动简报已跳过，明天会按原计划恢复。");
      setStatus("今天的计划简报已跳过。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "跳过今天失败";
      setSkipMessage(`操作失败：${message}`);
      setStatus(message);
    } finally { setSkipBusy(false); }
  }

  async function deliverNow(): Promise<void> {
    if (!user || !brief) return;
    if (!savedSubscription || savedSubscription.deliveryChannel === "web") {
      setDeliveryMessage(draftSubscription.deliveryChannel === "web"
        ? "当前已保存为“仅站内”，请先选择“邮件”或“Webhook”并保存。"
        : `${draftSubscription.deliveryChannel === "email" ? "邮件" : "Webhook"}设置尚未保存，请先保存订阅偏好。`);
      return;
    }
    if (subscriptionDirty) {
      setDeliveryMessage("订阅设置有未保存修改，请先保存后再投递。");
      return;
    }
    setDeliveryBusy(true);
    setDeliveryMessage("正在发送…");
    try {
      const job = await api.deliverBrief(brief.id, user.id);
      setDeliveries(await api.listDeliveries(brief.id));
      const message = job.status === "succeeded"
        ? "发送成功。"
        : job.status === "failed"
          ? "发送没有完成，请查看原因并重试。"
          : "正在后台发送。";
      setDeliveryMessage(message);
      setStatus(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : undefined;
      const message = deliveryFailureMessage(detail);
      setDeliveryMessage(`发送失败：${message}`);
      setStatus("外部发送没有完成，简报仍可在站内阅读。");
    } finally { setDeliveryBusy(false); }
  }

  async function retryDelivery(job: DeliveryJob): Promise<void> {
    if (!user || !brief) return;
    setDeliveryBusy(true);
    setDeliveryMessage("正在重新发送…");
    try {
      const updated = await api.retryDelivery(job.id, user.id);
      setDeliveries(await api.listDeliveries(brief.id));
      const message = updated.status === "succeeded" ? "重新发送成功。" : "已提交重新发送，正在后台处理。";
      setDeliveryMessage(message);
      setStatus(message);
    } catch (error) {
      const detail = error instanceof Error ? error.message : undefined;
      const message = deliveryFailureMessage(detail);
      setDeliveryMessage(`重新发送失败：${message}`);
      setStatus("重新发送没有完成，简报仍可在站内阅读。");
    } finally { setDeliveryBusy(false); }
  }

  const currentLocalDate = localDateInTimezone(savedSubscription?.timezone ?? draftSubscription.timezone);
  const todaySkipped = savedSubscription
    ? savedSubscription.skipDates.includes(currentLocalDate)
    : false;
  const todayViewState = resolveTodayViewState({
    ...(run?.status ? { runStatus: run.status } : {}),
    hasSelectedBrief: Boolean(brief),
    selectedBriefIsToday: brief?.localDate === currentLocalDate,
    todaySkipped,
  });
  const draftChannelLabel = draftSubscription.deliveryChannel === "email" ? "邮件简报" : draftSubscription.deliveryChannel === "webhook" ? "Webhook" : "站内简报";
  const savedDeliveryChannel = savedSubscription?.deliveryChannel;
  const savedChannelLabel = savedDeliveryChannel === "email" ? "邮件" : savedDeliveryChannel === "webhook" ? "Webhook" : "仅站内";
  const deliveryViewState = resolveDeliveryViewState(savedDeliveryChannel, deliveries);
  const latestDelivery = deliveries.at(-1);
  const deliveryCopy = deliveryStateCopy(deliveryViewState, savedDeliveryChannel);
  const visibleSaveMessage = subscriptionDirty && saveMessage === "订阅偏好已保存，新的推送渠道现在生效。"
    ? undefined
    : saveMessage;
  const todayTitle = todayViewState === "generating"
    ? "正在准备今天的简报"
    : todayViewState === "ready"
      ? "今天的简报已准备好"
      : todayViewState === "latest"
        ? "今天还没有新简报"
        : todayViewState === "failed"
          ? "今天的简报生成失败"
          : todayViewState === "skipped"
            ? "今天的自动简报已跳过"
            : "今天还没有简报";
  const todayDescription = todayViewState === "generating"
    ? "Agent 正在搜索、核验并整理新闻，完成后会自动显示在这里。"
    : todayViewState === "ready"
      ? "你可以直接开始阅读；外部投递状态会显示在简报末尾。"
      : todayViewState === "latest"
        ? `下面展示的是 ${brief?.localDate ?? "最近"} 的简报，你也可以生成今天的新简报。`
        : todayViewState === "failed"
          ? "本次生成没有完成。你可以重新生成，或到高级功能中查看运行详情。"
          : todayViewState === "skipped"
            ? "自动任务今天不会再运行，但你仍然可以手动生成一份简报。"
            : "准备好后，生成一份今天的个性化新闻简报。";

  return <main className="shell">
    <header className="hero"><span className="eyebrow">NEWS AGENT · R2</span><h1>每日 AI 新闻助手</h1><p>按你的偏好自主搜索、核验并整理一份带来源的新闻简报。</p></header>
    <section className="status" aria-live="polite"><span className={busy ? "pulse" : "dot"}/>{status}</section>
    {!user ? <section className="card"><h2>创建演示身份</h2><form onSubmit={(event) => void createIdentity(event)}><label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required/></label><button disabled={busy}>创建身份</button></form></section> : <>
      {view !== "onboarding" && <nav className="tabs">
        {primaryNavigation.map((item) => <button className={item.id === "settings" ? isSettingsArea(view) ? "active-tab" : "" : view === item.id ? "active-tab" : ""} key={item.id} onClick={() => navigatePrimary(item.id)}>{item.label}</button>)}
      </nav>}

      {view === "onboarding" && <section className="card onboarding-card"><div className="onboarding-heading"><div><span className="eyebrow">首次设置 · {onboardingStep}/{onboardingStepCount}</span><h2>{onboardingSteps[onboardingStep - 1]?.title}</h2><p>只需要完成必要设置，其他选项以后随时可以调整。</p></div><div className="onboarding-progress" aria-label={`首次设置进度 ${onboardingStep}/${onboardingStepCount}`}>{onboardingSteps.map((step, index) => <span className={index + 1 <= onboardingStep ? "complete" : ""} key={step.id}/>)}</div></div><form onSubmit={(event) => void completeOnboarding(event)}>
        {onboardingStep === 1 && <div className="onboarding-fields"><label>你最关注什么？<textarea value={draftSubscription.topics.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, topics: splitList(event.target.value)})} placeholder="例如：大模型、AI Agent、机器人"/></label><label>特别关注的关键词<input value={draftSubscription.keywords.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, keywords: splitList(event.target.value)})} placeholder="例如：OpenAI、Claude"/></label><div className="feedback-grid"><label>新闻语言<input value={draftSubscription.languages.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, languages: splitList(event.target.value)})}/></label><label>每份最多几条<input type="number" min={1} max={20} value={draftSubscription.maxItems} onChange={(event) => setDraftSubscription({...draftSubscription, maxItems: Number(event.target.value)})}/></label></div></div>}
        {onboardingStep === 2 && <div className="onboarding-fields"><div className="feedback-grid"><label>接收频率<select value={draftSubscription.scheduleCron.endsWith("1-5") ? "weekdays" : "daily"} onChange={(event) => updateSchedule(event.target.value as "daily" | "weekdays", scheduleTime())}><option value="daily">每天</option><option value="weekdays">工作日</option></select></label><label>接收时间<input type="time" value={scheduleTime()} onChange={(event) => updateSchedule(draftSubscription.scheduleCron.endsWith("1-5") ? "weekdays" : "daily", event.target.value)}/></label></div><label>所在时区<input value={draftSubscription.timezone} onChange={(event) => setDraftSubscription({...draftSubscription, timezone: event.target.value})}/><small>系统会按这个时区理解“今天”和你的接收时间。</small></label></div>}
        {onboardingStep === 3 && <div className="onboarding-fields"><div className="channel-options"><button type="button" className={draftSubscription.deliveryChannel === "web" ? "channel-option selected" : "channel-option"} onClick={() => setDraftSubscription({...draftSubscription, deliveryChannel: "web"})}><strong>站内阅读</strong><span>简报生成后保存在“今日”，不发送外部消息。</span></button><button type="button" className={draftSubscription.deliveryChannel === "email" ? "channel-option selected" : "channel-option"} onClick={() => setDraftSubscription({...draftSubscription, deliveryChannel: "email"})}><strong>邮件接收</strong><span>生成后发送到本地已配置的邮箱，同时保留站内版本。</span></button></div><p className="inline-note">Webhook 和其他高级选项可以稍后在设置中开启。</p></div>}
        <div className="onboarding-actions">{onboardingStep > 1 && <button type="button" className="secondary-control" onClick={() => setOnboardingStep((current) => clampOnboardingStep(current - 1))}>上一步</button>}<span/>{onboardingStep < onboardingStepCount ? <button type="button" onClick={() => setOnboardingStep((current) => clampOnboardingStep(current + 1))}>下一步</button> : <button disabled={busy}>{busy ? "正在保存…" : "保存并生成第一份简报"}</button>}</div>
      </form></section>}

      {view === "settings" && <div className="settings-stack"><section className="card"><div className="card-heading"><div><h2>订阅设置</h2><p>当前身份：{user.displayName}。修改会先保留在本页，点击保存后才生效。</p></div><span className="badge">{draftChannelLabel}{subscriptionDirty ? " · 未保存" : ""}</span></div><form className="settings-form" onSubmit={(event) => void savePreferences(event)}>
        <fieldset className="settings-section"><legend>内容偏好</legend><p>告诉我们哪些内容值得出现在你的每日简报里。</p><div className="grid">
          <label>关注话题<textarea value={draftSubscription.topics.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, topics: splitList(event.target.value)})}/></label>
          <label>关键词<textarea value={draftSubscription.keywords.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, keywords: splitList(event.target.value)})}/></label>
          <label>新闻语言<input value={draftSubscription.languages.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, languages: splitList(event.target.value)})}/></label>
          <label>每份最多几条<input type="number" min={1} max={20} value={draftSubscription.maxItems} onChange={(event) => setDraftSubscription({...draftSubscription, maxItems: Number(event.target.value)})}/></label>
        </div></fieldset>
        <fieldset className="settings-section"><legend>时间安排</legend><p>系统会按你的时区理解“今天”和计划接收时间。</p><div className="grid">
          <label>接收频率<select value={draftSubscription.scheduleCron.endsWith("1-5") ? "weekdays" : "daily"} onChange={(event) => updateSchedule(event.target.value as "daily" | "weekdays", scheduleTime())}><option value="daily">每天</option><option value="weekdays">工作日</option></select></label>
          <label>接收时间<input type="time" value={scheduleTime()} onChange={(event) => updateSchedule(draftSubscription.scheduleCron.endsWith("1-5") ? "weekdays" : "daily", event.target.value)}/></label>
          <label>所在时区<input value={draftSubscription.timezone} onChange={(event) => setDraftSubscription({...draftSubscription, timezone: event.target.value})}/></label>
          <label>暂停至<input type="date" value={draftSubscription.pausedUntil ?? ""} onChange={(event) => setDraftSubscription({...draftSubscription, pausedUntil: event.target.value || null})}/></label>
          <label className="toggle"><input type="checkbox" checked={draftSubscription.enabled} onChange={(event) => setDraftSubscription({...draftSubscription, enabled: event.target.checked})}/>启用每日简报</label>
          <div className="inline-action"><button type="button" className="secondary-control" disabled={skipBusy || todaySkipped} onClick={() => void skipToday()}>{skipBusy ? "处理中…" : todaySkipped ? "今天已跳过" : "跳过今天的自动简报"}</button><small className={skipMessage?.startsWith("操作失败") ? "inline-error" : "inline-note"}>{skipMessage ?? (!savedSubscription ? "保存订阅后才能使用；只影响自动任务。" : "仅跳过今天的自动生成，手动生成仍可使用。")}</small></div>
        </div></fieldset>
        <fieldset className="settings-section"><legend>接收方式</legend><p>选择简报生成后保存在哪里。外部投递只使用已保存的渠道。</p><div className="channel-options">
          <button type="button" className={draftSubscription.deliveryChannel === "web" ? "channel-option selected" : "channel-option"} onClick={() => { setDraftSubscription({...draftSubscription, deliveryChannel: "web"}); setSaveMessage("接收方式已修改，保存后才会生效。"); }}><strong>站内阅读</strong><span>只保存在“今日”，不发送外部消息。</span></button>
          <button type="button" className={draftSubscription.deliveryChannel === "email" ? "channel-option selected" : "channel-option"} onClick={() => { setDraftSubscription({...draftSubscription, deliveryChannel: "email"}); setSaveMessage("邮件设置尚未保存，保存后才会生效。"); }}><strong>邮件接收</strong><span>发送到本地已配置的邮箱，同时保留站内版本。</span></button>
        </div>{draftSubscription.deliveryChannel === "email" && <small className="inline-note">邮件地址由服务端现有配置管理；本页不会显示或修改个人邮箱。</small>}</fieldset>
        <details className="advanced-settings"><summary>高级设置</summary><p>只有需要精确过滤来源或接入自动化系统时才需要这些选项。</p><div className="grid">
          <label>排除关键词<input value={draftSubscription.excludedKeywords.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, excludedKeywords: splitList(event.target.value)})}/></label>
          <label>限定来源<input value={draftSubscription.sourceIds.join("，")} onChange={(event) => setDraftSubscription({...draftSubscription, sourceIds: splitList(event.target.value)})} placeholder="留空表示不限"/></label>
          <button type="button" className={draftSubscription.deliveryChannel === "webhook" ? "channel-option selected wide" : "channel-option wide"} onClick={() => { setDraftSubscription({...draftSubscription, deliveryChannel: "webhook"}); setSaveMessage("Webhook 设置尚未保存，保存后才会生效。"); }}><strong>Webhook 投递</strong><span>将简报交给服务端已配置的 Webhook；保存前不会改变当前投递方式。</span></button>
        </div></details>
        <div className="inline-action"><button disabled={busy || !subscriptionDirty}>{busy ? "保存中…" : subscriptionDirty ? "保存订阅设置" : "设置已保存"}</button><small className={visibleSaveMessage?.startsWith("保存失败") ? "inline-error" : "inline-note"}>{visibleSaveMessage ?? (subscriptionDirty ? "当前修改尚未保存，不会影响生成或投递。" : "当前设置已保存。")}</small></div>
      </form></section><section className="card advanced-panel"><div><h2>个性化与诊断</h2><p>画像、运行过程和质量指标不会影响日常阅读，需要时再查看。</p></div><div className="item-actions"><button className="secondary-control" onClick={() => { navigateTo("personalization"); void loadProfile(user.id); }}>个性化画像</button><button className="secondary-control" onClick={() => navigateTo("run")}>运行详情</button><button className="secondary-control" onClick={() => { navigateTo("quality"); void loadMetrics(user.id); }}>质量概览</button></div></section></div>}

      {view === "personalization" && <section className="card"><button className="text-button back-link" onClick={() => navigateTo("settings")}>← 返回设置</button><div className="card-heading"><div><h2>个性化画像</h2><p>系统只会把你明确接受的推断偏好用于排序；显式排除词始终优先。</p></div><label className="toggle"><input type="checkbox" checked={profile?.enabled ?? draftSubscription.personalizationEnabled ?? true} onChange={(event) => void togglePersonalization(event.target.checked)}/>启用个性化排序</label></div>{profile ? <><section className="profile-section"><h3>推断偏好</h3>{profile.inferredPreferences.length ? profile.inferredPreferences.map((preference) => <div className="preference-row" key={preference.id}><div><strong>{preference.value}</strong><span>{preference.kind} · {preference.status} · 置信度 {Math.round(preference.confidence * 100)}% · {preference.evidenceCount} 条证据</span></div><div className="preference-weight"><button className="secondary" disabled={preference.status !== "accepted"} onClick={() => void updatePreference(preference, { weight: Math.max(-2, preference.weight - 0.25) })}>−</button><b>{preference.weight.toFixed(2)}</b><button className="secondary" disabled={preference.status !== "accepted"} onClick={() => void updatePreference(preference, { weight: Math.min(2, preference.weight + 0.25) })}>＋</button></div><div className="item-actions">{preference.status !== "accepted" && <button className="active" onClick={() => void updatePreference(preference, { status: "accepted" })}>接受</button>}{preference.status !== "dismissed" && <button className="secondary" onClick={() => void updatePreference(preference, { status: "dismissed" })}>忽略</button>}<button className="text-button" onClick={() => void deletePreference(preference.id)}>删除</button></div></div>) : <p>积累至少两条同类反馈后，这里会出现可确认的推断偏好。</p>}</section><section className="profile-section"><h3>近 30 天负向信号</h3>{profile.recentNegativeSignals.length ? <ul>{profile.recentNegativeSignals.map((signal) => <li key={`${signal.topic}-${signal.reason}`}>{signal.topic} · {signal.reason} × {signal.count}</li>)}</ul> : <p>暂无。</p>}</section><section className="profile-section"><h3>持续追踪</h3>{profile.trackedTopics.length ? <ul>{profile.trackedTopics.map((topic) => <li key={topic.id}>{topic.label}</li>)}</ul> : <p>暂无。</p>}</section></> : <p>正在加载画像…</p>}</section>}

      {view === "quality" && <section className="card"><button className="text-button back-link" onClick={() => navigateTo("settings")}>← 返回设置</button><div className="card-heading"><div><h2>近 30 天质量概览</h2><p>汇总反馈、生成、投递、成本与性能，不包含新闻正文或投递地址。</p></div></div>{metrics ? <div className="metrics-grid"><article><span>简报有用率</span><strong>{Math.round(metrics.quality.briefUsefulRate * 100)}%</strong><small>{metrics.quality.briefCount} 份简报</small></article><article><span>条目有用率</span><strong>{Math.round(metrics.quality.itemUsefulRate * 100)}%</strong><small>{metrics.quality.itemCount} 条新闻</small></article><article><span>交叉验证率</span><strong>{Math.round(metrics.quality.multiSourceCoverage * 100)}%</strong><small>至少两个来源</small></article><article><span>生成成功率</span><strong>{Math.round(metrics.reliability.generationSuccessRate * 100)}%</strong><small>{metrics.reliability.missedBriefCount} 次遗漏</small></article><article><span>投递成功率</span><strong>{Math.round(metrics.reliability.deliverySuccessRate * 100)}%</strong><small>平均 {metrics.reliability.averageDeliveryAttempts.toFixed(1)} 次尝试</small></article><article><span>平均耗时</span><strong>{Math.round(metrics.performance.averageDurationMs / 1000)}s</strong><small>${metrics.performance.costUsd.toFixed(4)} 总成本</small></article></div> : <p>正在加载指标…</p>}</section>}

      {view === "run" && <section className="card"><button className="text-button back-link" onClick={() => navigateTo("settings")}>← 返回设置</button><div className="card-heading"><div><h2>运行详情</h2><p>{run ? `${run.status} · ${run.toolCallCount} 次工具调用` : "尚未运行"}</p></div>{run && ["queued","running"].includes(run.status) && <button className="danger" onClick={() => void cancelRun()}>取消</button>}</div><div className="timeline">{events.length ? events.map((event, index) => <div className="event" key={`${event.timestamp}-${index}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><strong>{event.type}</strong><span>{event.toolName ?? event.delta ?? event.error ?? event.status ?? ""}</span></div>) : <p>生成简报后，这里会显示详细运行过程。</p>}</div></section>}

      {view === "today" && <div className="today-stack"><section className="card today-summary"><div><span className="eyebrow">TODAY · {currentLocalDate}</span><h2>{todayTitle}</h2><p>{todayDescription}</p></div><div className="item-actions">{todayViewState === "generating" ? <><button className="secondary-control" onClick={() => navigateTo("run")}>查看进度</button><button className="danger" disabled={busy} onClick={() => void cancelRun()}>取消生成</button></> : !savedSubscription ? <button onClick={() => navigateTo("settings")}>完成订阅设置</button> : <button disabled={busy} onClick={() => void startRun()}>{busy ? "正在启动…" : todayViewState === "failed" ? "重新生成" : todayViewState === "ready" ? "更新今日简报" : "生成今天的简报"}</button>}</div></section><section className="history-layout"><section className="card list"><h2>往期简报</h2>{briefs.length ? briefs.map((item) => <button className={brief?.id === item.id ? "brief-link active-brief" : "brief-link"} key={item.id} onClick={() => void openBrief(item.id)}><strong>{item.title}</strong><span>{item.localDate === currentLocalDate ? "今天" : item.localDate}</span></button>) : <p>生成后，简报会保存在这里。</p>}</section>{brief && <article className="card brief"><div className="brief-context"><span>{brief.localDate === currentLocalDate ? "今日简报" : `${brief.localDate} · 往期简报`}</span></div><h2>{brief.title}</h2><p>{brief.overview}</p>{brief.items.map((item) => {
        const saved = savedItems.some((savedItem) => savedItem.briefItemId === item.id);
        const tracked = trackedTopics.some((topic) => topic.sourceBriefItemId === item.id && topic.status !== "closed");
        const disliked = hasActiveNegativeFeedback(feedback?.itemFeedback ?? [], item.id);
        const itemBusy = Boolean(pendingItemActions[item.id]);
        const itemMessage = itemActionMessages[item.id];
        const reasonsOpen = openNegativeFeedbackItemId === item.id;
        return <section className="brief-item" key={item.id}><h3>{item.rank}. {item.headline}</h3><p className="item-summary">{item.summary}</p><p className="why-it-matters"><b>为什么重要：</b>{item.whyItMatters}</p>{item.recommendationReason && <p className="recommendation-reason"><b>为什么推荐：</b>{item.recommendationReason}</p>}<div className="brief-labels">{item.section && <span>{item.section}</span>}{item.novelty && <span>{item.novelty}</span>}{item.evidenceStatus && <span>{item.evidenceStatus}</span>}</div><details className="source-list"><summary>查看 {item.sources.length} 个来源</summary><ul>{item.sources.map((source) => <li key={source.articleId}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.sourceName} · {source.title}</a></li>)}</ul></details><div className="item-feedback"><div className="item-actions primary-item-actions" aria-label="新闻反馈"><button className={isFeedbackActive(item.id, "useful") ? "active" : "secondary"} disabled={itemBusy} onClick={() => void toggleItemFeedback(item.id, "useful")}>{pendingItemActions[item.id] === "feedback:useful" ? "保存中…" : isFeedbackActive(item.id, "useful") ? "有帮助 ✓" : "有帮助"}</button><button type="button" className={disliked ? "active" : "secondary"} disabled={itemBusy} aria-expanded={reasonsOpen} aria-controls={`negative-reasons-${item.id}`} onClick={() => setOpenNegativeFeedbackItemId(reasonsOpen ? undefined : item.id)}>{disliked ? "不喜欢 · 已反馈" : "不喜欢"}</button><button className={saved ? "active" : "secondary"} disabled={itemBusy} onClick={() => void toggleSavedItem(item.id)}>{pendingItemActions[item.id] === "save" ? "处理中…" : saved ? "已收藏" : "收藏"}</button></div>{reasonsOpen && <div className="feedback-reasons" id={`negative-reasons-${item.id}`}><span>请选择原因（可以撤回）</span><div>{negativeFeedbackOptions.map((option) => <button type="button" className={isFeedbackActive(item.id, option.type) ? "active" : "secondary"} disabled={itemBusy} key={option.type} onClick={() => void toggleItemFeedback(item.id, option.type)}>{pendingItemActions[item.id] === `feedback:${option.type}` ? "保存中…" : option.label}</button>)}</div></div>}{saved && <div className="secondary-item-action"><span>想持续关注这条新闻的后续？</span><button type="button" className="text-button" disabled={itemBusy || tracked} onClick={() => void trackItem(item.id)}>{pendingItemActions[item.id] === "track" ? "添加中…" : tracked ? "已在持续追踪" : "继续追踪"}</button></div>}{itemMessage && <small className={itemMessage.tone === "error" ? "inline-error" : "inline-note"} aria-live="polite">{itemMessage.text}</small>}</div></section>;
      })}<form className="brief-feedback" onSubmit={(event) => void saveOverallFeedback(event)}><h3>评价本期简报</h3><div className="feedback-grid"><label>整体是否有用<select value={briefFeedbackDraft.usefulness ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, usefulness: (event.target.value || null) as BriefUsefulness | null})}><option value="">暂不评价</option><option value="useful">有用</option><option value="neutral">一般</option><option value="not_useful">没用</option></select></label><label>内容长度<select value={briefFeedbackDraft.lengthRating ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, lengthRating: (event.target.value || null) as BriefLengthRating | null})}><option value="">暂不评价</option><option value="too_short">太少</option><option value="about_right">合适</option><option value="too_long">太多</option></select></label></div><label className="toggle"><input type="checkbox" checked={briefFeedbackDraft.missedImportantNews ?? false} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, missedImportantNews: event.target.checked})}/>遗漏了重要新闻</label><label>备注（可选）<textarea maxLength={1000} value={briefFeedbackDraft.comment ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, comment: event.target.value})}/></label><div className="inline-action"><button disabled={briefFeedbackBusy}>{briefFeedbackBusy ? "保存中…" : "保存评价"}</button>{briefFeedbackMessage && <small className={briefFeedbackMessage.startsWith("保存失败") ? "inline-error" : "inline-note"} aria-live="polite">{briefFeedbackMessage}</small>}</div></form><section className={`delivery-panel delivery-${deliveryViewState}`}><div className="delivery-summary"><div><span className="delivery-badge">{deliveryCopy.badge}</span><h3>{deliveryCopy.title}</h3><p>{deliveryCopy.description}</p></div>{deliveryViewState === "failed" && latestDelivery ? <button className="danger" disabled={deliveryBusy} onClick={() => void retryDelivery(latestDelivery)}>{deliveryBusy ? "重试中…" : "重新发送"}</button> : deliveryViewState === "awaiting" || deliveryViewState === "cancelled" ? <button className="text-button" disabled={deliveryBusy || subscriptionDirty} onClick={() => void deliverNow()}>{deliveryBusy ? "发送中…" : "现在发送"}</button> : deliveryViewState === "configuration_required" || deliveryViewState === "onsite" ? <button className="text-button" onClick={() => { setView("settings"); setDeliveryMessage(undefined); }}>调整接收方式</button> : null}</div>{deliveryViewState === "failed" && <p className="delivery-error">{deliveryFailureMessage(latestDelivery?.lastError)}</p>}{subscriptionDirty && <small className="inline-error">接收设置有未保存修改；这里仍按已保存的“{savedChannelLabel}”显示和操作。</small>}{deliveryMessage && <small className={deliveryMessage.includes("失败") ? "inline-error" : "inline-note"} aria-live="polite">{deliveryMessage}</small>}{deliveries.length > 0 && <details className="delivery-details"><summary>查看发送详情</summary>{deliveries.map((job) => <div className="delivery-row" key={job.id}><div><span>{job.channel === "email" ? "邮件" : "Webhook"} · {job.status === "succeeded" ? "已发送" : job.status === "failed" ? "失败" : job.status === "cancelled" ? "已取消" : "处理中"} · 已尝试 {job.attemptCount} 次</span>{job.deliveredAt && <small>完成于 {new Date(job.deliveredAt).toLocaleString()}</small>}{job.attempts.map((attempt) => <small key={attempt.id}>第 {attempt.attemptNumber} 次：{attempt.status === "succeeded" ? "成功" : "失败"}</small>)}</div></div>)}</details>}</section><a href={`/api/briefs/${brief.id}/markdown`} target="_blank" rel="noreferrer">查看 Markdown</a></article>}</section></div>}

      {view === "library" && <section className="library-layout"><section className="card list"><h2>收藏</h2>{savedItems.length ? savedItems.map((item) => <div className="library-item" key={item.id}><button className="brief-link" onClick={() => void openBrief(item.briefId)}><strong>{item.headline}</strong><span>{item.topic}</span></button><button className="text-button" onClick={() => void toggleSavedItem(item.briefItemId)}>取消收藏</button></div>) : <p>尚未收藏新闻。</p>}</section><section className="card list"><h2>持续追踪</h2>{trackedTopics.length ? trackedTopics.map((topic) => <div className="library-item" key={topic.id}><strong>{topic.label}</strong><span className="muted">{topic.status}</span><div className="item-actions">{topic.status === "active" ? <button className="secondary" onClick={() => void updateTracking(topic, "paused")}>暂停</button> : topic.status === "paused" ? <button className="secondary" onClick={() => void updateTracking(topic, "active")}>恢复</button> : null}{topic.status !== "closed" && <button className="secondary" onClick={() => void updateTracking(topic, "closed")}>停止</button>}</div></div>) : <p>尚未追踪新闻。</p>}</section></section>}
    </>}
  </main>;
}
