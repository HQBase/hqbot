import {
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Globe2,
  Inbox,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react"
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"

import type { BotTask, BotTeammate, WorkspaceSnapshot } from "../domain/types"

const tokenKey = "hqbot-owner-token"
const newAgentId = "__new_agent__"
const terminalStatuses = new Set(["completed", "failed"])

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (init?.body) headers.set("Content-Type", "application/json")
  const response = await fetch(path, { ...init, headers })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed with status ${response.status}`)
  return body
}

function initials(name: string): string {
  return name
    .split(/\s+/u)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function statusLabel(task: BotTask | null): string {
  if (!task) return "Ready"
  return (
    {
      queued: "Queued",
      working: "Planning",
      researching: "Researching",
      awaiting_approval: "Needs approval",
      replying: "Replying",
      completed: "Complete",
      failed: "Needs attention",
    }[task.status] ?? task.status
  )
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
        <p className="eyebrow">Self-hosted in your Cloudflare account</p>
        <h1>Open HQBot</h1>
        <p className="access-copy">
          Your teammates, computers, connections, memory, and work history are self-hosted.
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
            Open workspace <ChevronRight size={16} />
          </button>
        </form>
        <div className="trust-line">
          <ShieldCheck size={15} /> No shared HQBot runtime
        </div>
      </section>
    </main>
  )
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenKey) ?? "")
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const [polling, setPolling] = useState(false)
  const [approving, setApproving] = useState<string | null>(null)
  const [connectOpen, setConnectOpen] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)

  const load = useCallback(
    async (requestedBotId?: string | null) => {
      if (!token) return
      const botId = requestedBotId ?? selectedBotId
      const query = botId && botId !== newAgentId ? `?botId=${encodeURIComponent(botId)}` : ""
      try {
        const next = await api<WorkspaceSnapshot>(`/api/snapshot${query}`, token)
        setSnapshot(next)
        if (botId !== newAgentId) {
          setSelectedBotId(next.selectedBot?.id ?? newAgentId)
          setSelectedTaskId(
            (current) => current ?? next.activeTask?.id ?? next.tasks[0]?.id ?? null,
          )
        }
        setError("")
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "HQBot could not load")
      }
    },
    [selectedBotId, token],
  )

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 2_500)
    return () => window.clearInterval(timer)
  }, [load])

  const selectedBot =
    selectedBotId === newAgentId
      ? null
      : (snapshot?.bots.find((candidate) => candidate.id === selectedBotId) ??
        snapshot?.selectedBot ??
        null)
  const selectedTask = useMemo(
    () =>
      snapshot?.tasks.find((task) => task.id === selectedTaskId) ?? snapshot?.activeTask ?? null,
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
        if (!response.ok) throw new Error("Computer evidence could not load")
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

  async function submitMessage(event: FormEvent) {
    event.preventDefault()
    const value = prompt.trim()
    if (!value || sending) return
    setSending(true)
    setError("")
    try {
      if (!selectedBot) {
        const created = await api<{ teammate: BotTeammate }>("/api/bots", token, {
          method: "POST",
          body: JSON.stringify({ brief: value }),
        })
        setPrompt("")
        setSelectedBotId(created.teammate.id)
        setSelectedTaskId(null)
        await load(created.teammate.id)
      } else {
        const created = await api<{ taskId: string }>(`/api/bots/${selectedBot.id}/tasks`, token, {
          method: "POST",
          body: JSON.stringify({ prompt: value }),
        })
        setPrompt("")
        setSelectedTaskId(created.taskId)
        await load(selectedBot.id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message could not be sent")
    } finally {
      setSending(false)
    }
  }

  async function pollNow() {
    setPolling(true)
    try {
      await api("/api/poll", token, { method: "POST" })
      await load(selectedBot?.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbox check failed")
    } finally {
      setPolling(false)
    }
  }

  async function resolveApproval(taskId: string, approved: boolean) {
    setApproving(taskId)
    setError("")
    try {
      await api(`/api/tasks/${taskId}/approval`, token, {
        method: "POST",
        body: JSON.stringify({ approved }),
      })
      await load(selectedBot?.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The approval could not be recorded")
    } finally {
      setApproving(null)
    }
  }

  function lockWorkspace() {
    sessionStorage.removeItem(tokenKey)
    setToken("")
    setSnapshot(null)
  }

  if (!token) return <AccessGate onUnlock={setToken} />
  if (!snapshot) {
    return (
      <main className="loading-screen">
        <LoaderCircle className="spin" /> <span>{error || "Waking your teammates…"}</span>
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
            <span>AI teammates</span>
          </div>
          <span className="live-pill">
            <i /> Connected
          </span>
        </div>

        <button
          className="new-task"
          type="button"
          onClick={() => {
            setSelectedBotId(newAgentId)
            setSelectedTaskId(null)
            setPrompt("")
          }}
        >
          <Plus size={16} /> New teammate
        </button>

        <nav className="roster" aria-label="AI teammates">
          <p className="nav-label">Teammates</p>
          <div className="bot-list">
            {snapshot.bots.map((teammate) => {
              const active = teammate.id === selectedBot?.id
              return (
                <button
                  className={active ? "bot-row active" : "bot-row"}
                  key={teammate.id}
                  type="button"
                  onClick={() => {
                    setSelectedBotId(teammate.id)
                    setSelectedTaskId(null)
                    void load(teammate.id)
                  }}
                >
                  <span className="avatar">{initials(teammate.name)}</span>
                  <span>
                    <strong>{teammate.name}</strong>
                    <small>
                      {teammate.connection ? teammate.connection.mailboxAddress : teammate.title}
                    </small>
                  </span>
                  <span className="online-dot" />
                </button>
              )
            })}
          </div>

          {selectedBot ? <p className="nav-label tasks-label">Recent work</p> : null}
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

        <div className="sidebar-foot footer-actions">
          <CloudflareBadge />
          <button type="button" onClick={lockWorkspace} aria-label="Lock workspace">
            <LockKeyhole size={14} />
          </button>
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-head">
          <div>
            <p className="eyebrow">{selectedBot?.title ?? "Create a teammate in chat"}</p>
            <h1>{selectedBot?.name ?? "New teammate"}</h1>
          </div>
          {selectedBot ? (
            <div className={`status-chip ${working ? "working" : ""}`}>
              {working ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <span className="status-dot" />
              )}
              {statusLabel(selectedTask)}
            </div>
          ) : null}
        </header>

        <div className="transcript">
          {!selectedBot ? (
            <NewAgentWelcome onSuggestion={setPrompt} />
          ) : (
            <>
              <div className="message bot-message intro-message">
                <div className="message-meta">
                  <span className="mini-avatar">{initials(selectedBot.name)}</span>
                  {selectedBot.name}
                </div>
                <p>Good to meet you. What do you want me around for?</p>
              </div>
              <div className="message user-message setup-message">
                <div className="message-meta">
                  You <span>teammate brief</span>
                </div>
                <p>{selectedBot.brief}</p>
              </div>
              <div className="message bot-message setup-message">
                <div className="message-meta">
                  <span className="mini-avatar">{initials(selectedBot.name)}</span>
                  {selectedBot.name}
                </div>
                <p>{selectedBot.description}</p>
                {!selectedBot.connection ? (
                  <button
                    className="inline-connect"
                    type="button"
                    onClick={() => setConnectOpen(true)}
                  >
                    <Link2 size={14} /> Connect HQBase
                  </button>
                ) : null}
              </div>

              {[...snapshot.tasks].reverse().map((task) => {
                const taskActivity = snapshot.activeTask?.id === task.id ? activity : []
                return (
                  <div className="task-exchange" key={task.id}>
                    <div className="date-rule">
                      <span>{new Date(task.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="message user-message">
                      <div className="message-meta">
                        {task.source === "email" ? task.sender : "You"}
                        <span>{task.source === "email" ? "via HQBase" : "direct"}</span>
                      </div>
                      {task.subject ? <strong className="subject">{task.subject}</strong> : null}
                      <p>{task.prompt}</p>
                    </div>
                    {taskActivity.map((item, index) => (
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
                    {task.result ? (
                      <div className="message bot-message">
                        <div className="message-meta">
                          <span className="mini-avatar">{initials(selectedBot.name)}</span>
                          {selectedBot.name}
                          <span>
                            {task.replyMessageId
                              ? "sent through HQBase"
                              : task.status === "awaiting_approval"
                                ? "draft reply"
                                : "finished work"}
                          </span>
                        </div>
                        <p>{task.result}</p>
                      </div>
                    ) : null}
                    {task.status === "awaiting_approval" ? (
                      <div className="approval-card">
                        <div>
                          <ShieldCheck size={17} />
                          <span>
                            <strong>Approve this reply?</strong>
                            <small>HQBot will send it through the connected HQBase mailbox.</small>
                          </span>
                        </div>
                        <div>
                          <button
                            type="button"
                            disabled={approving === task.id}
                            onClick={() => void resolveApproval(task.id, false)}
                          >
                            Keep as draft
                          </button>
                          <button
                            className="approve-button"
                            type="button"
                            disabled={approving === task.id}
                            onClick={() => void resolveApproval(task.id, true)}
                          >
                            {approving === task.id ? (
                              <LoaderCircle className="spin" size={14} />
                            ) : (
                              <ArrowUp size={14} />
                            )}
                            Send reply
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {task.error ? (
                      <div className="error-card">
                        <CircleAlert size={18} />
                        <div>
                          <strong>{selectedBot.name} needs attention</strong>
                          <p>{task.error}</p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </>
          )}
        </div>

        <form className="composer" onSubmit={submitMessage}>
          {error ? <div className="composer-error">{error}</div> : null}
          <textarea
            aria-label={selectedBot ? `Message ${selectedBot.name}` : "Describe your new agent"}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              selectedBot
                ? `Message ${selectedBot.name}…`
                : "What do you want this teammate around for?"
            }
            rows={3}
          />
          <div className="composer-actions">
            <span>
              {selectedBot ? (
                <button className="add-context" type="button" onClick={() => setConnectOpen(true)}>
                  <Plus size={14} /> Connect
                </button>
              ) : (
                <>
                  <Sparkles size={14} /> Creates a durable teammate
                </>
              )}
            </span>
            <button
              className="send-button"
              disabled={!prompt.trim() || sending}
              type="submit"
              aria-label="Send"
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
              <span>{selectedBot ? `${selectedBot.name}'s computer` : "Teammate computer"}</span>
            </div>
            <span className="cloud-label">YOUR CLOUDFLARE</span>
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
                <img src={screenshotUrl} alt="The final page from this teammate's browser work" />
              ) : (
                <div className="computer-idle">
                  <div className="radar">
                    <span />
                  </div>
                  <Globe2 size={28} />
                  <strong>{working ? "Computer is working" : "Computer ready"}</strong>
                  <p>Each teammate works in a cloud browser in your account.</p>
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
              <Link2 size={16} />
              <span>Connections</span>
            </div>
            {selectedBot?.connection ? (
              <button
                onClick={() => void pollNow()}
                disabled={polling}
                aria-label="Check connected HQBase inbox"
                type="button"
              >
                {polling ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
              </button>
            ) : null}
          </div>
          {selectedBot?.connection ? (
            <>
              <div className="routine-name">
                <span className="routine-icon">
                  <Inbox size={17} />
                </span>
                <div>
                  <strong>HQBase</strong>
                  <p>{selectedBot.connection.mailboxAddress}</p>
                </div>
                <span className="enabled-badge">ON</span>
              </div>
              <dl>
                <div>
                  <dt>Checks</dt>
                  <dd>Every minute</dd>
                </div>
                <div>
                  <dt>Work</dt>
                  <dd>Research and reply</dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{selectedBot.connection.mailboxName}</dd>
                </div>
              </dl>
              <p className="routine-note">
                <ShieldCheck size={14} /> Encrypted connection. Mail stays in HQBase.
              </p>
            </>
          ) : (
            <div className="empty-connection">
              <span>
                <Plus size={18} />
              </span>
              <strong>{selectedBot ? "Connect a tool" : "Choose a teammate"}</strong>
              <p>
                {selectedBot
                  ? "Give this teammate its own HQBase mailbox connection."
                  : "Connections belong to one teammate."}
              </p>
              {selectedBot ? (
                <button type="button" onClick={() => setConnectOpen(true)}>
                  Connect HQBase
                </button>
              ) : null}
            </div>
          )}
        </section>
      </aside>

      {connectOpen && selectedBot ? (
        <ConnectionDialog
          bot={selectedBot}
          token={token}
          onClose={() => setConnectOpen(false)}
          onConnected={async () => {
            setConnectOpen(false)
            await load(selectedBot.id)
          }}
        />
      ) : null}
    </main>
  )
}

function NewAgentWelcome({ onSuggestion }: { onSuggestion: (value: string) => void }) {
  return (
    <div className="welcome-block">
      <span className="avatar large-avatar">+</span>
      <p className="eyebrow">New teammate</p>
      <h2>What do you want me around for?</h2>
      <p>
        Describe a concrete job or a general sidekick. HQBot will create a durable teammate from
        this chat.
      </p>
      <div className="suggestions">
        <button
          type="button"
          onClick={() =>
            onSuggestion(
              "Be my inbox manager. Research requests, draft useful replies, and keep me informed.",
            )
          }
        >
          Inbox manager <ArrowUp size={14} />
        </button>
        <button
          type="button"
          onClick={() =>
            onSuggestion(
              "Be my research analyst. Investigate questions in a real browser and return concise, sourced work.",
            )
          }
        >
          Research analyst <ArrowUp size={14} />
        </button>
      </div>
    </div>
  )
}

function ConnectionDialog({
  bot,
  token,
  onClose,
  onConnected,
}: {
  bot: BotTeammate
  token: string
  onClose: () => void
  onConnected: () => Promise<void>
}) {
  const [origin, setOrigin] = useState("https://")
  const [credential, setCredential] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  async function connect(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      await api(`/api/bots/${bot.id}/connections/hqbase`, token, {
        method: "POST",
        body: JSON.stringify({ origin, token: credential }),
      })
      await onConnected()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "HQBase could not connect")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
      >
        <header>
          <div>
            <span className="connection-logo">
              <Inbox size={20} />
            </span>
            <div>
              <p className="eyebrow">Connect to {bot.name}</p>
              <h2 id="connection-title">HQBase</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection dialog">
            <X size={17} />
          </button>
        </header>
        <p className="dialog-copy">
          Connect one mailbox-scoped HQBase agent. {bot.name} will watch that inbox, research new
          requests, and reply through HQBase.
        </p>
        <form onSubmit={connect}>
          <label htmlFor="hqbase-origin">HQBase URL</label>
          <input
            id="hqbase-origin"
            type="url"
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
            placeholder="https://mail.example.com"
            required
          />
          <label htmlFor="hqbase-token">Agent connection credential</label>
          <input
            id="hqbase-token"
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            placeholder="hqb_agent_…"
            required
          />
          <p className="field-help">
            Create a mailbox agent with <strong>Handle mail</strong> access in HQBase. Paste the
            one-time credential here.
          </p>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button"
            type="submit"
            disabled={saving || !origin.trim() || !credential.trim()}
          >
            {saving ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
            Connect to {bot.name}
          </button>
        </form>
        <div className="dialog-trust">
          <ShieldCheck size={14} /> Encrypted before storage in your Cloudflare account
        </div>
      </section>
    </div>
  )
}

function CloudflareBadge() {
  return (
    <div className="cloudflare-badge">
      <span className="cf-mark">☁</span>
      <div>
        <strong>Your Cloudflare</strong>
        <small>Workers · AI · Browser · R2</small>
      </div>
    </div>
  )
}
