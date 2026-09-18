import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AgentRunRecord, BriefDetail, SavedBrief, UpsertSubscriptionInput, User } from "@news-agent/shared";

import { api, type RunEvent } from "./api/client";

const defaultSubscription: UpsertSubscriptionInput = {
  topics: ["大模型", "AI Agent"], keywords: ["OpenAI", "Claude", "Pi"], excludedKeywords: [],
  languages: ["zh-CN", "en"], sourceIds: [], maxItems: 5, scheduleCron: "0 8 * * *",
  timezone: "Asia/Shanghai", deliveryChannel: "web", enabled: true,
};

function splitList(value: string): string[] {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

export function App() {
  const [user, setUser] = useState<User>();
  const [displayName, setDisplayName] = useState("");
  const [form, setForm] = useState<UpsertSubscriptionInput>(defaultSubscription);
  const [status, setStatus] = useState("请先创建一个本地演示身份。");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"settings" | "run" | "history">("settings");
  const [run, setRun] = useState<AgentRunRecord>();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [briefs, setBriefs] = useState<SavedBrief[]>([]);
  const [brief, setBrief] = useState<BriefDetail>();
  const closeEvents = useRef<() => void>(() => undefined);

  async function loadHistory(userId: string): Promise<void> {
    setBriefs(await api.listBriefs(userId));
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
        ]);
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
            setRun(record); setBusy(false); setStatus(record.status === "succeeded" ? "简报生成完成。" : `运行已${record.status}。`);
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
    if (history[0]) setBrief(await api.getBrief(history[0].id));
  }

  async function openBrief(id: string): Promise<void> {
    setBrief(await api.getBrief(id)); setView("history");
  }

  async function cancelRun(): Promise<void> {
    if (!run) return;
    const result = await api.cancelRun(run.id);
    if (result.cancelled) setStatus("已请求取消运行。");
  }

  return <main className="shell">
    <header className="hero"><span className="eyebrow">NEWS AGENT · MVP</span><h1>每日 AI 新闻助手</h1><p>按你的偏好自主搜索、核验并整理一份带来源的新闻简报。</p></header>
    <section className="status" aria-live="polite"><span className={busy ? "pulse" : "dot"}/>{status}</section>
    {!user ? <section className="card"><h2>创建演示身份</h2><form onSubmit={(event) => void createIdentity(event)}><label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={100} required/></label><button disabled={busy}>创建身份</button></form></section> : <>
      <nav className="tabs"><button onClick={() => setView("settings")}>偏好设置</button><button onClick={() => setView("run")}>运行详情</button><button onClick={() => { setView("history"); void loadHistory(user.id); }}>历史简报</button><button className="primary" disabled={busy} onClick={() => void startRun()}>立即生成</button></nav>
      {view === "settings" && <section className="card"><div className="card-heading"><div><h2>订阅偏好</h2><p>当前身份：{user.displayName}</p></div><span className="badge">站内简报</span></div><form className="grid" onSubmit={(event) => void savePreferences(event)}>
        <label>关注话题<textarea value={form.topics.join("，")} onChange={(event) => setForm({...form, topics: splitList(event.target.value)})}/></label>
        <label>关键词<textarea value={form.keywords.join("，")} onChange={(event) => setForm({...form, keywords: splitList(event.target.value)})}/></label>
        <label>排除关键词<input value={form.excludedKeywords.join("，")} onChange={(event) => setForm({...form, excludedKeywords: splitList(event.target.value)})}/></label>
        <label>新闻语言<input value={form.languages.join("，")} onChange={(event) => setForm({...form, languages: splitList(event.target.value)})}/></label>
        <label>限定来源<input value={form.sourceIds.join("，")} onChange={(event) => setForm({...form, sourceIds: splitList(event.target.value)})} placeholder="留空表示不限"/></label>
        <label>每日条目数<input type="number" min={1} max={20} value={form.maxItems} onChange={(event) => setForm({...form, maxItems: Number(event.target.value)})}/></label>
        <label>时区<input value={form.timezone} onChange={(event) => setForm({...form, timezone: event.target.value})}/></label>
        <label>推送计划（Cron）<input value={form.scheduleCron} onChange={(event) => setForm({...form, scheduleCron: event.target.value})}/></label>
        <label className="toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({...form, enabled: event.target.checked})}/>启用每日简报</label>
        <button className="wide" disabled={busy}>保存订阅偏好</button>
      </form></section>}
      {view === "run" && <section className="card"><div className="card-heading"><div><h2>运行详情</h2><p>{run ? `${run.status} · ${run.toolCallCount} 次工具调用` : "尚未运行"}</p></div>{run && ["queued","running"].includes(run.status) && <button className="danger" onClick={() => void cancelRun()}>取消</button>}</div><div className="timeline">{events.length ? events.map((event, index) => <div className="event" key={`${event.timestamp}-${index}`}><time>{new Date(event.timestamp).toLocaleTimeString()}</time><strong>{event.type}</strong><span>{event.toolName ?? event.delta ?? event.error ?? event.status ?? ""}</span></div>) : <p>点击“立即生成”查看 Agent 的实时工具调用。</p>}</div></section>}
      {view === "history" && <section className="history-layout"><section className="card list"><h2>历史简报</h2>{briefs.length ? briefs.map((item) => <button className="brief-link" key={item.id} onClick={() => void openBrief(item.id)}><strong>{item.title}</strong><span>{item.localDate}</span></button>) : <p>暂无简报。</p>}</section>{brief && <article className="card brief"><h2>{brief.title}</h2><p>{brief.overview}</p>{brief.items.map((item) => <section key={item.id}><h3>{item.rank}. {item.headline}</h3><p>{item.summary}</p><p><b>为什么重要：</b>{item.whyItMatters}</p><ul>{item.sources.map((source) => <li key={source.articleId}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.sourceName} · {source.title}</a></li>)}</ul></section>)}<a href={`/api/briefs/${brief.id}/markdown`} target="_blank" rel="noreferrer">查看 Markdown</a></article>}</section>}
    </>}
  </main>;
}
