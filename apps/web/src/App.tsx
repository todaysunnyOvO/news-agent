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
  PersonalizationProfile,
  SavedBrief,
  SavedItem,
  TrackedTopic,
  UpsertBriefFeedbackInput,
  UpsertSubscriptionInput,
  User,
} from "@news-agent/shared";

import { api, type RunEvent } from "./api/client";

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

const itemFeedbackOptions: Array<{ type: BriefItemFeedbackType; label: string }> = [
  { type: "useful", label: "有用" },
  { type: "not_interested", label: "不感兴趣" },
  { type: "already_known", label: "已经知道" },
  { type: "repetitive", label: "重复/无新进展" },
];

function splitList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

export function App() {
  const [user, setUser] = useState<User>();
  const [displayName, setDisplayName] = useState("");
  const [form, setForm] = useState<UpsertSubscriptionInput>(defaultSubscription);
  const [status, setStatus] = useState("请先创建一个本地演示身份。");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"settings" | "personalization" | "run" | "history" | "library">("settings");
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
  const closeEvents = useRef<() => void>(() => undefined);

  async function loadHistory(userId: string): Promise<void> {
    setBriefs(await api.listBriefs(userId));
  }

  async function loadLibrary(userId: string): Promise<void> {
    const [saved, tracked] = await Promise.all([api.listSavedItems(userId), api.listTrackedTopics(userId)]);
    setSavedItems(saved);
    setTrackedTopics(tracked);
  }

  async function loadProfile(userId: string): Promise<void> {
    setProfile(await api.getPreferenceProfile(userId));
  }

  useEffect(() => {
    const savedUserId = localStorage.getItem("news-agent-user-id");
    if (!savedUserId) return;
    void (async () => {
      try {
        const restored = await api.getUser(savedUserId);
        setUser(restored);
        setStatus(`欢迎回来，${restored.displayName}`);
        await Promise.all([
          api.getSubscription(savedUserId).then(setForm).catch(() => setStatus("身份已恢复，请保存订阅偏好。")),
          loadHistory(savedUserId),
          loadLibrary(savedUserId),
          loadProfile(savedUserId).catch(() => undefined),
        ]);
        const linkedBrief = new URLSearchParams(window.location.search).get("brief");
        if (linkedBrief) await openBrief(linkedBrief, savedUserId);
      } catch { localStorage.removeItem("news-agent-user-id"); }
    })();
    return () => closeEvents.current();
  }, []);

  async function createIdentity(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      const created = await api.createUser({ displayName });
      localStorage.setItem("news-agent-user-id", created.id);
      setUser(created); setStatus("身份已创建，请保存订阅偏好。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "创建身份失败"); }
    finally { setBusy(false); }
  }

  async function savePreferences(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    try { await api.saveSubscription(user.id, form); setStatus("订阅偏好已保存。"); }
    catch (error) { setStatus(error instanceof Error ? error.message : "保存订阅失败"); }
    finally { setBusy(false); }
  }

  async function togglePersonalization(enabled: boolean): Promise<void> {
    if (!user) return;
    try {
      const updated = await api.setPersonalizationEnabled(user.id, enabled);
      setForm(updated);
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
    setBusy(true); setEvents([]); setBrief(undefined); setView("run");
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
          void loadHistory(user.id);
          if (next.status === "succeeded") setTimeout(() => void loadLatestBrief(user.id), 50);
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

  async function openBrief(id: string, explicitUserId?: string): Promise<void> {
    const userId = explicitUserId ?? user?.id;
    if (!userId) return;
    const [detail, currentFeedback, currentDeliveries] = await Promise.all([
      api.getBrief(id), api.getBriefFeedback(id, userId), api.listDeliveries(id),
    ]);
    setBrief(detail); setFeedback(currentFeedback);
    setDeliveries(currentDeliveries);
    setBriefFeedbackDraft({
      usefulness: currentFeedback.briefFeedback?.usefulness ?? null,
      lengthRating: currentFeedback.briefFeedback?.lengthRating ?? null,
      missedImportantNews: currentFeedback.briefFeedback?.missedImportantNews ?? false,
      comment: currentFeedback.briefFeedback?.comment ?? "",
    });
    setView("history");
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
    if (!user || !brief) return;
    const active = !isFeedbackActive(itemId, type);
    try {
      await api.setItemFeedback(itemId, user.id, type, active);
      setFeedback(await api.getBriefFeedback(brief.id, user.id));
      setStatus(active ? "反馈已记录。" : "反馈已撤回。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "保存反馈失败"); }
  }

  async function saveOverallFeedback(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!user || !brief) return;
    try {
      await api.saveBriefFeedback(brief.id, user.id, briefFeedbackDraft);
      setFeedback(await api.getBriefFeedback(brief.id, user.id));
      setStatus("本期简报评价已保存。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "保存简报评价失败"); }
  }

  async function toggleSavedItem(itemId: string): Promise<void> {
    if (!user) return;
    const saved = savedItems.some((item) => item.briefItemId === itemId);
    if (saved) await api.removeSavedItem(itemId, user.id); else await api.saveItem(itemId, user.id);
    await loadLibrary(user.id);
    setStatus(saved ? "已取消收藏。" : "已收藏。");
  }

  async function trackItem(itemId: string): Promise<void> {
    if (!user) return;
    await api.trackItem(itemId, user.id);
    await loadLibrary(user.id);
    setStatus("已加入持续追踪。");
  }

  async function updateTracking(topic: TrackedTopic, nextStatus: "active" | "paused" | "closed") {
    if (!user) return;
    await api.updateTrackedTopic(topic.id, user.id, { status: nextStatus });
    await loadLibrary(user.id);
    setStatus(nextStatus === "closed" ? "已停止追踪。" : nextStatus === "paused" ? "已暂停追踪。" : "已恢复追踪。");
  }

  function updateSchedule(mode: "daily" | "weekdays", time: string): void {
    const [hour = "8", minute = "0"] = time.split(":");
    setForm({ ...form, scheduleCron: `${Number(minute)} ${Number(hour)} * * ${mode === "weekdays" ? "1-5" : "*"}` });
  }

  function scheduleTime(): string {
    const [minute = "0", hour = "8"] = form.scheduleCron.split(/\s+/);
    return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  async function skipToday(): Promise<void> {
    if (!user) return;
    const updated = await api.skipToday(user.id);
    setForm(updated);
    setStatus("今天的计划简报已跳过。");
  }

  async function deliverNow(): Promise<void> {
    if (!user || !brief) return;
    try {
      await api.deliverBrief(brief.id, user.id);
      setDeliveries(await api.listDeliveries(brief.id));
      setStatus("已创建投递任务。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "创建投递失败"); }
  }

  async function retryDelivery(job: DeliveryJob): Promise<void> {
    if (!user || !brief) return;
    try {
      await api.retryDelivery(job.id, user.id);
      setDeliveries(await api.listDeliveries(brief.id));
      setStatus("已重试投递。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "重试失败"); }
  }

  return <main className="shell">
    <header className="hero"><span className="eyebrow">NEWS AGENT · R2</span><h1>每日 AI 新闻助手</h1><p>按你的偏好自主搜索、核验并整理一份带来源的新闻简报。</p></header>
    <section className="status" aria-live="polite"><span className={busy ? "pulse" : "dot"}/>{status}</section>
    {!user ? <section className="card"><h2>创建演示身份</h2><form onSubmit={(event) => void createIdentity(event)}><label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required/></label><button disabled={busy}>创建身份</button></form></section> : <>
      <nav className="tabs">
        <button onClick={() => setView("settings")}>偏好设置</button>
        <button onClick={() => { setView("personalization"); void loadProfile(user.id); }}>个性化画像</button>
        <button onClick={() => setView("run")}>运行详情</button>
        <button onClick={() => { setView("history"); void loadHistory(user.id); }}>历史简报</button>
        <button onClick={() => { setView("library"); void loadLibrary(user.id); }}>收藏与追踪</button>
        <button className="primary" disabled={busy} onClick={() => void startRun()}>立即生成</button>
      </nav>

      {view === "settings" && <section className="card"><div className="card-heading"><div><h2>订阅偏好</h2><p>当前身份：{user.displayName}</p></div><span className="badge">站内简报</span></div><form className="grid" onSubmit={(event) => void savePreferences(event)}>
        <label>关注话题<textarea value={form.topics.join("，")} onChange={(event) => setForm({...form, topics: splitList(event.target.value)})}/></label>
        <label>关键词<textarea value={form.keywords.join("，")} onChange={(event) => setForm({...form, keywords: splitList(event.target.value)})}/></label>
        <label>排除关键词<input value={form.excludedKeywords.join("，")} onChange={(event) => setForm({...form, excludedKeywords: splitList(event.target.value)})}/></label>
        <label>新闻语言<input value={form.languages.join("，")} onChange={(event) => setForm({...form, languages: splitList(event.target.value)})}/></label>
        <label>限定来源<input value={form.sourceIds.join("，")} onChange={(event) => setForm({...form, sourceIds: splitList(event.target.value)})} placeholder="留空表示不限"/></label>
        <label>每日条目数<input type="number" min={1} max={20} value={form.maxItems} onChange={(event) => setForm({...form, maxItems: Number(event.target.value)})}/></label>
        <label>时区<input value={form.timezone} onChange={(event) => setForm({...form, timezone: event.target.value})}/></label>
        <label>推送频率<select value={form.scheduleCron.endsWith("1-5") ? "weekdays" : "daily"} onChange={(event) => updateSchedule(event.target.value as "daily" | "weekdays", scheduleTime())}><option value="daily">每天</option><option value="weekdays">工作日</option></select></label>
        <label>推送时间<input type="time" value={scheduleTime()} onChange={(event) => updateSchedule(form.scheduleCron.endsWith("1-5") ? "weekdays" : "daily", event.target.value)}/></label>
        <label>推送渠道<select value={form.deliveryChannel} onChange={(event) => setForm({...form, deliveryChannel: event.target.value as UpsertSubscriptionInput["deliveryChannel"]})}><option value="web">仅站内</option><option value="email">邮件</option><option value="webhook">Webhook</option></select></label>
        <label>暂停至<input type="date" value={form.pausedUntil ?? ""} onChange={(event) => setForm({...form, pausedUntil: event.target.value || null})}/></label>
        <label className="toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({...form, enabled: event.target.checked})}/>启用每日简报</label>
        <button type="button" className="secondary-control" onClick={() => void skipToday()}>今天不推送</button>
        <button className="wide" disabled={busy}>保存订阅偏好</button>
      </form></section>}

      {view === "personalization" && <section className="card"><div className="card-heading"><div><h2>个性化画像</h2><p>系统只会把你明确接受的推断偏好用于排序；显式排除词始终优先。</p></div><label className="toggle"><input type="checkbox" checked={profile?.enabled ?? form.personalizationEnabled ?? true} onChange={(event) => void togglePersonalization(event.target.checked)}/>启用个性化排序</label></div>{profile ? <><section className="profile-section"><h3>推断偏好</h3>{profile.inferredPreferences.length ? profile.inferredPreferences.map((preference) => <div className="preference-row" key={preference.id}><div><strong>{preference.value}</strong><span>{preference.kind} · {preference.status} · 置信度 {Math.round(preference.confidence * 100)}% · {preference.evidenceCount} 条证据</span></div><div className="preference-weight"><button className="secondary" disabled={preference.status !== "accepted"} onClick={() => void updatePreference(preference, { weight: Math.max(-2, preference.weight - 0.25) })}>−</button><b>{preference.weight.toFixed(2)}</b><button className="secondary" disabled={preference.status !== "accepted"} onClick={() => void updatePreference(preference, { weight: Math.min(2, preference.weight + 0.25) })}>＋</button></div><div className="item-actions">{preference.status !== "accepted" && <button className="active" onClick={() => void updatePreference(preference, { status: "accepted" })}>接受</button>}{preference.status !== "dismissed" && <button className="secondary" onClick={() => void updatePreference(preference, { status: "dismissed" })}>忽略</button>}<button className="text-button" onClick={() => void deletePreference(preference.id)}>删除</button></div></div>) : <p>积累至少两条同类反馈后，这里会出现可确认的推断偏好。</p>}</section><section className="profile-section"><h3>近 30 天负向信号</h3>{profile.recentNegativeSignals.length ? <ul>{profile.recentNegativeSignals.map((signal) => <li key={`${signal.topic}-${signal.reason}`}>{signal.topic} · {signal.reason} × {signal.count}</li>)}</ul> : <p>暂无。</p>}</section><section className="profile-section"><h3>持续追踪</h3>{profile.trackedTopics.length ? <ul>{profile.trackedTopics.map((topic) => <li key={topic.id}>{topic.label}</li>)}</ul> : <p>暂无。</p>}</section></> : <p>正在加载画像…</p>}</section>}

      {view === "run" && <section className="card"><div className="card-heading"><div><h2>运行详情</h2><p>{run ? `${run.status} · ${run.toolCallCount} 次工具调用` : "尚未运行"}</p></div>{run && ["queued","running"].includes(run.status) && <button className="danger" onClick={() => void cancelRun()}>取消</button>}</div><div className="timeline">{events.length ? events.map((event, index) => <div className="event" key={`${event.timestamp}-${index}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><strong>{event.type}</strong><span>{event.toolName ?? event.delta ?? event.error ?? event.status ?? ""}</span></div>) : <p>点击“立即生成”查看 Agent 的实时工具调用。</p>}</div></section>}

      {view === "history" && <section className="history-layout"><section className="card list"><h2>历史简报</h2>{briefs.length ? briefs.map((item) => <button className="brief-link" key={item.id} onClick={() => void openBrief(item.id)}><strong>{item.title}</strong><span>{item.localDate}</span></button>) : <p>暂无简报。</p>}</section>{brief && <article className="card brief"><h2>{brief.title}</h2><p>{brief.overview}</p>{brief.items.map((item) => {
        const saved = savedItems.some((savedItem) => savedItem.briefItemId === item.id);
        const tracked = trackedTopics.some((topic) => topic.sourceBriefItemId === item.id && topic.status !== "closed");
        return <section className="brief-item" key={item.id}><h3>{item.rank}. {item.headline}</h3><p>{item.summary}</p><p><b>为什么重要：</b>{item.whyItMatters}</p><ul>{item.sources.map((source) => <li key={source.articleId}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.sourceName} · {source.title}</a></li>)}</ul><div className="item-actions" aria-label="新闻反馈">{itemFeedbackOptions.map((option) => <button className={isFeedbackActive(item.id, option.type) ? "active" : "secondary"} key={option.type} onClick={() => void toggleItemFeedback(item.id, option.type)}>{option.label}</button>)}<button className={saved ? "active" : "secondary"} onClick={() => void toggleSavedItem(item.id)}>{saved ? "已收藏" : "收藏"}</button><button className={tracked ? "active" : "secondary"} disabled={tracked} onClick={() => void trackItem(item.id)}>{tracked ? "追踪中" : "继续追踪"}</button></div></section>;
      })}<form className="brief-feedback" onSubmit={(event) => void saveOverallFeedback(event)}><h3>评价本期简报</h3><div className="feedback-grid"><label>整体是否有用<select value={briefFeedbackDraft.usefulness ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, usefulness: (event.target.value || null) as BriefUsefulness | null})}><option value="">暂不评价</option><option value="useful">有用</option><option value="neutral">一般</option><option value="not_useful">没用</option></select></label><label>内容长度<select value={briefFeedbackDraft.lengthRating ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, lengthRating: (event.target.value || null) as BriefLengthRating | null})}><option value="">暂不评价</option><option value="too_short">太少</option><option value="about_right">合适</option><option value="too_long">太多</option></select></label></div><label className="toggle"><input type="checkbox" checked={briefFeedbackDraft.missedImportantNews ?? false} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, missedImportantNews: event.target.checked})}/>遗漏了重要新闻</label><label>备注（可选）<textarea maxLength={1000} value={briefFeedbackDraft.comment ?? ""} onChange={(event) => setBriefFeedbackDraft({...briefFeedbackDraft, comment: event.target.value})}/></label><button>保存评价</button></form><section className="delivery-panel"><h3>投递状态</h3>{deliveries.length ? deliveries.map((job) => <div className="delivery-row" key={job.id}><div><span>{job.channel} · {job.status} · 尝试 {job.attemptCount} 次</span>{job.lastError && <small>{job.lastError}</small>}{job.attempts.map((attempt) => <small key={attempt.id}>#{attempt.attemptNumber} {attempt.status}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</small>)}</div>{job.status === "failed" && <button className="secondary" onClick={() => void retryDelivery(job)}>重新投递</button>}</div>) : <p>尚无外部投递记录。</p>}<button className="secondary-control" onClick={() => void deliverNow()}>立即投递</button></section><a href={`/api/briefs/${brief.id}/markdown`} target="_blank" rel="noreferrer">查看 Markdown</a></article>}</section>}

      {view === "library" && <section className="library-layout"><section className="card list"><h2>收藏</h2>{savedItems.length ? savedItems.map((item) => <div className="library-item" key={item.id}><button className="brief-link" onClick={() => void openBrief(item.briefId)}><strong>{item.headline}</strong><span>{item.topic}</span></button><button className="text-button" onClick={() => void toggleSavedItem(item.briefItemId)}>取消收藏</button></div>) : <p>尚未收藏新闻。</p>}</section><section className="card list"><h2>持续追踪</h2>{trackedTopics.length ? trackedTopics.map((topic) => <div className="library-item" key={topic.id}><strong>{topic.label}</strong><span className="muted">{topic.status}</span><div className="item-actions">{topic.status === "active" ? <button className="secondary" onClick={() => void updateTracking(topic, "paused")}>暂停</button> : topic.status === "paused" ? <button className="secondary" onClick={() => void updateTracking(topic, "active")}>恢复</button> : null}{topic.status !== "closed" && <button className="secondary" onClick={() => void updateTracking(topic, "closed")}>停止</button>}</div></div>) : <p>尚未追踪新闻。</p>}</section></section>}
    </>}
  </main>;
}
