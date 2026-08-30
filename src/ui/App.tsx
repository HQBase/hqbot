import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Globe2,
  Inbox,
  KeyRound,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"

import type { BotSnapshot, BotTask } from "../domain/types"

const tokenKey = "hqbot-owner-token"
const terminalStatuses = new Set(["completed", "failed"])
const newTaskId = "__new__"

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await fetch(path, { ...init, headers })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`)
  return body
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

function statusLabel(task: BotTask | null): string {
  if (!task) return "Ready"
  const labels: Record<string, string> = {
    queued: "Queued",
    working: "Planning",
    researching: "Researching",
    replying: "Replying",
    completed: "Complete",
    failed: "Needs attention",
  }
  return labels[task.status] ?? task.status
}

function AccessGate({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    try {
      await api("/api/snapshot", value)
      sessionStorage.setItem(tokenKey, value)
      onUnlock(value)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access failed")
    }
  }

  return (
    <main className="access-shell">
      <div className="access-grid" aria-hidden="true" />
      <section className="access-card">
        <div className="brand-mark large">
          <Bot size={27} strokeWidth={1.7} />
        </div>
        <p className="eyebrow">Customer-owned agent</p>
        <h1>Welcome to HQBot</h1>
        <p className="access-copy">
          Your teammate, browser, memory, and work history run in your Cloudflare account.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="owner-token">
            <KeyRound size={15} /> Owner token
          </label>
          <input
            id="owner-token"
            autoComplete="off"
            type="password"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Paste the token from installation"
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={!value.trim()} type="submit">
            Open HQBot <ChevronRight size={16} />
          </button>
        </form>
        <div className="trust-line">
          <ShieldCheck size={15} /> No HQBot cloud account. No shared runtime.
        </div>
      </section>
    </main>
  )
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? "")
  const [snapshot, setSnapshot] = useState<BotSnapshot | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [polling, setPolling] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      const next = await api<BotSnapshot>("/api/snapshot", token)
      setSnapshot(next)
      setSelectedTaskId(
        (current) => current ?? next.activeTask?.id ?? next.tasks[0]?.id ?? newTaskId,
      )
      setError("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HQBot could not load")
    }
  }, [token])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2_500)
    return () => window.clearInterval(timer)
  }, [refresh])

  const selectedTask = useMemo(
    () =>
      selectedTaskId === newTaskId
        ? null
        : (snapshot?.tasks.find((task) => task.id === selectedTaskId) ??
          snapshot?.activeTask ??
          null),
    [selectedTaskId, snapshot],
  )

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setScreenshotUrl(null)
    if (!token || !selectedTask?.screenshotKey) return
    void fetch(`/api/artifacts/${encodeURIComponent(selectedTask.screenshotKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error("Browser evidence could not load")
        return response.blob()
      })
      .then((blob) => {
        if (!active) return
        objectUrl = URL.createObjectURL(blob)
        setScreenshotUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedTask?.screenshotKey, token])

  async function submitTask(event: FormEvent) {
    event.preventDefault()
    const value = prompt.trim()
    if (!value || sending) return
    setSending(true)
    setError("")
    try {
      const created = await api<{ taskId: string }>("/api/tasks", token, {
        method: "POST",
        body: JSON.stringify({ prompt: value }),
      })
      setPrompt("")
      setSelectedTaskId(created.taskId)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The task could not start")
    } finally {
      setSending(false)
    }
  }

  async function pollNow() {
    setPolling(true)
    try {
      await api("/api/poll", token, { method: "POST" })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbox check failed")
    } finally {
      setPolling(false)
    }
  }

  if (!token) return <AccessGate onUnlock={setToken} />
  if (!snapshot) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" /> <span>{error || "Waking HQBot…"}</span>
      </main>
    )
  }

  const working = selectedTask ? !terminalStatuses.has(selectedTask.status) : false
  const activity = snapshot.activeTask?.id === selectedTask?.id ? snapshot.activity : []

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Bot size={20} strokeWidth={1.8} />
          </div>
          <div>
            <strong>HQBot</strong>
            <span>Self-hosted</span>
          </div>
          <span className="live-pill">
            <i /> LIVE
          </span>
        </div>

        <button
          className="new-task"
          type="button"
          onClick={() => {
            setSelectedTaskId(newTaskId)
            setPrompt("")
          }}
        >
          <Sparkles size={16} /> New task
        </button>

        <nav className="roster" aria-label="Bot roster">
          <p className="nav-label">Your team</p>
          <button className="bot-row active" type="button">
            <span className="avatar">HQ</span>
            <span>
              <strong>{snapshot.profile.name}</strong>
              <small>{statusLabel(snapshot.activeTask)}</small>
            </span>
            {snapshot.activeTask && !terminalStatuses.has(snapshot.activeTask.status) ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <span className="online-dot" />
            )}
          </button>
          <p className="nav-label tasks-label">Recent work</p>
          <div className="task-list">
            {snapshot.tasks.map((task) => (
              <button
                className={task.id === selectedTask?.id ? "task-row selected" : "task-row"}
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                type="button"
              >
                {task.source === "email" ? <Inbox size={14} /> : <TerminalSquare size={14} />}
                <span>
                  <strong>{task.subject || task.prompt}</strong>
                  <small>{relativeTime(task.createdAt)}</small>
                </span>
                {task.status === "failed" ? (
                  <CircleAlert className="danger" size={14} />
                ) : task.status === "completed" ? (
                  <Check size={14} />
                ) : (
                  <span className="working-pulse" />
                )}
              </button>
            ))}
          </div>
        </nav>

        <div className="sidebar-foot">
          <CloudflareBadge />
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-head">
          <div>
            <p className="eyebrow">{snapshot.profile.title}</p>
            <h1>{snapshot.profile.name}</h1>
          </div>
          <div className={`status-chip ${working ? "working" : ""}`}>
            {working ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <span className="status-dot" />
            )}
            {statusLabel(selectedTask)}
          </div>
        </header>

        <div className="transcript">
          {!selectedTask ? (
            <div className="welcome-block">
              <span className="avatar large-avatar">HQ</span>
              <p className="eyebrow">Always on</p>
              <h2>Hand off the whole job.</h2>
              <p>{snapshot.profile.description}</p>
              <div className="suggestions">
                <button
                  type="button"
                  onClick={() =>
                    setPrompt(
                      "Research the current HQBase product and explain its main self-hosting advantage with source links.",
                    )
                  }
                >
                  Research a product <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPrompt(
                      "Compare two public sources about Cloudflare Agents and give me a concise recommendation.",
                    )
                  }
                >
                  Compare sources <ArrowUp size={14} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="date-rule">
                <span>{new Date(selectedTask.createdAt).toLocaleString()}</span>
              </div>
              <div className="message user-message">
                <div className="message-meta">
                  {selectedTask.source === "email" ? selectedTask.sender : "You"}
                  <span>{selectedTask.source === "email" ? "via HQBase" : "direct"}</span>
                </div>
                {selectedTask.subject ? (
                  <strong className="subject">{selectedTask.subject}</strong>
                ) : null}
                <p>{selectedTask.prompt}</p>
              </div>
              {activity.map((item, index) => (
                <div
                  className="activity-row"
                  key={item.id}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <span className="activity-icon">
                    {item.phase === "browser" ? (
                      <Globe2 size={15} />
                    ) : item.phase === "completed" ? (
                      <Check size={15} />
                    ) : item.phase === "failed" ? (
                      <CircleAlert size={15} />
                    ) : (
                      <Search size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    {item.detail ? <p>{item.detail}</p> : null}
                  </div>
                  <time>{relativeTime(item.createdAt)}</time>
                </div>
              ))}
              {selectedTask.result ? (
                <div className="message bot-message">
                  <div className="message-meta">
                    <span className="mini-avatar">HQ</span> HQBot{" "}
                    <span>{selectedTask.replyMessageId ? "sent through HQBase" : "result"}</span>
                  </div>
                  <p>{selectedTask.result}</p>
                </div>
              ) : null}
              {selectedTask.error ? (
                <div className="error-card">
                  <CircleAlert size={18} />
                  <div>
                    <strong>HQBot needs attention</strong>
                    <p>{selectedTask.error}</p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <form className="composer" onSubmit={submitTask}>
          {error ? <div className="composer-error">{error}</div> : null}
          <textarea
            aria-label="Message HQBot"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Give HQBot a task…"
            rows={3}
          />
          <div className="composer-actions">
            <span>
              <Globe2 size={14} /> Public web <ShieldCheck size={14} /> Read-only research
            </span>
            <button
              className="send-button"
              disabled={!prompt.trim() || sending}
              type="submit"
              aria-label="Send task"
            >
              {sending ? <LoaderCircle className="spin" size={17} /> : <ArrowUp size={17} />}
            </button>
          </div>
        </form>
      </section>

      <aside className="workbench">
        <section className="computer-card">
          <header>
            <div>
              <Monitor size={16} />
              <span>Agent computer</span>
            </div>
            <span className="cloud-label">CLOUDFLARE</span>
          </header>
          <div className="browser-chrome">
            <div className="browser-top">
              <span className="browser-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="address-bar">
                {selectedTask?.browserUrl || "Browser Run — ready"}
              </span>
            </div>
            <div className="computer-view">
              {screenshotUrl ? (
                <img src={screenshotUrl} alt="The final page from HQBot's cloud browser research" />
              ) : (
                <div className="computer-idle">
                  <div className="radar">
                    <span />
                  </div>
                  <Globe2 size={28} />
                  <strong>{working ? "Browser is working" : "Computer ready"}</strong>
                  <p>HQBot uses a real browser in your Cloudflare account.</p>
                </div>
              )}
            </div>
          </div>
          <footer>
            <span>
              <i className={working ? "active" : ""} /> {working ? "Working" : "Idle"}
            </span>
            {selectedTask?.browserUrl ? (
              <a href={selectedTask.browserUrl} target="_blank" rel="noreferrer">
                Open source <ChevronRight size={13} />
              </a>
            ) : null}
          </footer>
        </section>

        <section className="routine-card">
          <div className="section-title">
            <div>
              <Clock3 size={16} />
              <span>Routine</span>
            </div>
            <button
              onClick={() => void pollNow()}
              disabled={polling}
              aria-label="Check HQBase inbox now"
              type="button"
            >
              {polling ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            </button>
          </div>
          <div className="routine-name">
            <span className="routine-icon">
              <Inbox size={17} />
            </span>
            <div>
              <strong>{snapshot.routine.name}</strong>
              <p>{snapshot.routine.mailboxAddress || "Mailbox not configured"}</p>
            </div>
            <span className="enabled-badge">ON</span>
          </div>
          <dl>
            <div>
              <dt>Runs</dt>
              <dd>{snapshot.routine.schedule}</dd>
            </div>
            <div>
              <dt>Action</dt>
              <dd>{snapshot.routine.autoReply ? "Research + reply" : "Research only"}</dd>
            </div>
            <div>
              <dt>Allowed</dt>
              <dd>{snapshot.routine.allowedSenders.join(", ") || "No senders"}</dd>
            </div>
          </dl>
          <p className="routine-note">
            <ShieldCheck size={14} /> Other senders stay in HQBase and do not start a task.
          </p>
        </section>
      </aside>
    </main>
  )
}

function CloudflareBadge() {
  return (
    <div className="cloudflare-badge">
      <span className="cf-mark">☁</span>
      <div>
        <strong>Runs on your Cloudflare</strong>
        <small>Workers · AI · Browser · R2</small>
      </div>
    </div>
  )
}
