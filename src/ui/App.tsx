import {
  ArrowUp,
  Bot,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  Globe2,
  Inbox,
  KeyRound,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Paperclip,
  Pause,
  Pencil,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react"
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { BotFile, BotRoutine, BotTask, BotTeammate, WorkspaceSnapshot } from "../domain/types"

const tokenKey = "hqbot-owner-token"
const newAgentId = "__new_agent__"
const terminalStatuses = new Set(["completed", "failed"])

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set("Authorization", `Bearer ${token}`)
  if (typeof init?.body === "string") headers.set("Content-Type", "application/json")
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

function formatInterval(minutes: number): string {
  if (minutes % 1_440 === 0) {
    const days = minutes / 1_440
    return `${days} day${days === 1 ? "" : "s"}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} hour${hours === 1 ? "" : "s"}`
  }
  return `${minutes} minutes`
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
  const [profileOpen, setProfileOpen] = useState(false)
  const [routineOpen, setRoutineOpen] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [memoryInput, setMemoryInput] = useState("")
  const [savingMemory, setSavingMemory] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<BotFile[]>([])
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

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
          body: JSON.stringify({
            prompt: value,
            fileIds: attachedFiles.map((file) => file.id),
          }),
        })
        setPrompt("")
        setAttachedFiles([])
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

  async function addMemory(event: FormEvent) {
    event.preventDefault()
    if (!selectedBot || !memoryInput.trim()) return
    setSavingMemory(true)
    try {
      await api(`/api/bots/${selectedBot.id}/memories`, token, {
        method: "POST",
        body: JSON.stringify({ content: memoryInput.trim() }),
      })
      setMemoryInput("")
      await load(selectedBot.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Memory could not be saved")
    } finally {
      setSavingMemory(false)
    }
  }

  async function deleteMemory(memoryId: string) {
    if (!selectedBot) return
    await api(`/api/bots/${selectedBot.id}/memories/${memoryId}`, token, { method: "DELETE" })
    await load(selectedBot.id)
  }

  async function updateRoutine(routine: BotRoutine, active: boolean) {
    if (!selectedBot) return
    await api(`/api/bots/${selectedBot.id}/routines/${routine.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    })
    await load(selectedBot.id)
  }

  async function runRoutine(routine: BotRoutine) {
    if (!selectedBot) return
    const created = await api<{ taskId: string }>(
      `/api/bots/${selectedBot.id}/routines/${routine.id}/run`,
      token,
      { method: "POST" },
    )
    setSelectedTaskId(created.taskId)
    await load(selectedBot.id)
  }

  async function deleteRoutine(routineId: string) {
    if (!selectedBot) return
    await api(`/api/bots/${selectedBot.id}/routines/${routineId}`, token, { method: "DELETE" })
    await load(selectedBot.id)
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!selectedBot || !file) return
    setUploadingFile(true)
    try {
      const form = new FormData()
      form.set("file", file)
      const uploaded = await api<{ file: BotFile }>(`/api/bots/${selectedBot.id}/files`, token, {
        method: "POST",
        body: form,
      })
      setAttachedFiles((current) => [...current, uploaded.file].slice(-5))
      await load(selectedBot.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The file could not be uploaded")
    } finally {
      setUploadingFile(false)
    }
  }

  async function deleteFile(file: BotFile) {
    if (!selectedBot) return
    await api(`/api/bots/${selectedBot.id}/files/${file.id}`, token, { method: "DELETE" })
    setAttachedFiles((current) => current.filter((candidate) => candidate.id !== file.id))
    await load(selectedBot.id)
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
            setAttachedFiles([])
          }}
        >
          <Plus size={16} /> New teammate
        </button>

        <nav className="roster" aria-label="AI teammates">
          <p className="nav-label">Teammates</p>
          <div className="bot-list">
            {snapshot.bots
              .filter((teammate) => !teammate.hidden || teammate.id === selectedBot?.id)
              .map((teammate) => {
                const active = teammate.id === selectedBot?.id
                return (
                  <button
                    className={active ? "bot-row active" : "bot-row"}
                    key={teammate.id}
                    type="button"
                    onClick={() => {
                      setSelectedBotId(teammate.id)
                      setSelectedTaskId(null)
                      setAttachedFiles([])
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
                    {teammate.pinned ? (
                      <Pin className="bot-pin" size={12} />
                    ) : (
                      <span className="online-dot" />
                    )}
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
            <div className="conversation-actions">
              <div className={`status-chip ${working ? "working" : ""}`}>
                {working ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <span className="status-dot" />
                )}
                {statusLabel(selectedTask)}
              </div>
              <button type="button" onClick={() => setProfileOpen(true)} aria-label="Edit teammate">
                <Pencil size={14} />
              </button>
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
          {selectedBot && snapshot.bots.some((bot) => bot.id !== selectedBot.id && !bot.hidden) ? (
            <div className="mention-hints">
              <span>Collaborate</span>
              {snapshot.bots
                .filter((bot) => bot.id !== selectedBot.id && !bot.hidden)
                .slice(0, 4)
                .map((bot) => (
                  <button
                    type="button"
                    key={bot.id}
                    onClick={() =>
                      setPrompt((current) => `${current}${current ? " " : ""}@${bot.name} `)
                    }
                  >
                    @{bot.name}
                  </button>
                ))}
            </div>
          ) : null}
          {attachedFiles.length > 0 ? (
            <div className="attached-files">
              {attachedFiles.map((file) => (
                <span key={file.id}>
                  <FileText size={12} /> {file.name}
                  <button
                    type="button"
                    onClick={() => void deleteFile(file)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
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
                <>
                  <input
                    ref={fileInput}
                    className="file-input"
                    type="file"
                    onChange={(event) => void uploadFile(event)}
                  />
                  <button
                    className="add-context"
                    type="button"
                    disabled={uploadingFile || attachedFiles.length >= 5}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploadingFile ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Paperclip size={14} />
                    )}
                    Attach
                  </button>
                  <button
                    className="add-context"
                    type="button"
                    onClick={() => setConnectOpen(true)}
                  >
                    <Link2 size={14} /> Connect
                  </button>
                </>
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

        <section className="capability-card">
          <div className="section-title">
            <div>
              <Sparkles size={15} />
              <span>Memory</span>
            </div>
            <span className="count-badge">{snapshot.memories.length}</span>
          </div>
          {selectedBot ? (
            <>
              <div className="compact-list">
                {snapshot.memories.length === 0 ? (
                  <p className="empty-copy">Save stable facts and preferences for future work.</p>
                ) : (
                  snapshot.memories.map((memory) => (
                    <div className="compact-row" key={memory.id}>
                      <p>{memory.content}</p>
                      <button
                        type="button"
                        onClick={() => void deleteMemory(memory.id)}
                        aria-label="Forget this memory"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <form className="compact-form" onSubmit={addMemory}>
                <input
                  value={memoryInput}
                  onChange={(event) => setMemoryInput(event.target.value)}
                  placeholder={`What should ${selectedBot.name} remember?`}
                  maxLength={500}
                />
                <button type="submit" disabled={savingMemory || !memoryInput.trim()}>
                  {savingMemory ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}
                </button>
              </form>
            </>
          ) : (
            <p className="empty-copy padded-copy">Choose a teammate to manage memory.</p>
          )}
        </section>

        <section className="capability-card">
          <div className="section-title">
            <div>
              <CalendarClock size={15} />
              <span>Routines</span>
            </div>
            {selectedBot ? (
              <button type="button" onClick={() => setRoutineOpen(true)} aria-label="New routine">
                <Plus size={14} />
              </button>
            ) : null}
          </div>
          <div className="compact-list routine-list">
            {snapshot.routines.length === 0 ? (
              <p className="empty-copy">
                Schedule repeat work. The browser starts only when needed.
              </p>
            ) : (
              snapshot.routines.map((routine) => (
                <div className="routine-row" key={routine.id}>
                  <div>
                    <strong>{routine.name}</strong>
                    <small>
                      Every {formatInterval(routine.intervalMinutes)} ·{" "}
                      {routine.active ? "On" : "Paused"}
                    </small>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => void runRoutine(routine)}
                      aria-label={`Run ${routine.name} now`}
                    >
                      <Play size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void updateRoutine(routine, !routine.active)}
                      aria-label={
                        routine.active ? `Pause ${routine.name}` : `Resume ${routine.name}`
                      }
                    >
                      {routine.active ? <Pause size={12} /> : <RefreshCw size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRoutine(routine.id)}
                      aria-label={`Delete ${routine.name}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="capability-card">
          <div className="section-title">
            <div>
              <FileText size={15} />
              <span>Files</span>
            </div>
            <span className="count-badge">{snapshot.files.length}</span>
          </div>
          <div className="compact-list">
            {snapshot.files.length === 0 ? (
              <p className="empty-copy">Attach a file in chat to keep it with this teammate.</p>
            ) : (
              snapshot.files.slice(0, 5).map((file) => (
                <div className="compact-row file-row" key={file.id}>
                  <FileText size={13} />
                  <p>{file.name}</p>
                  <button
                    type="button"
                    onClick={() => void deleteFile(file)}
                    aria-label={`Delete ${file.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
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
      {profileOpen && selectedBot ? (
        <ProfileDialog
          bot={selectedBot}
          token={token}
          onClose={() => setProfileOpen(false)}
          onSaved={async (botId) => {
            setProfileOpen(false)
            setSelectedBotId(botId)
            await load(botId)
          }}
        />
      ) : null}
      {routineOpen && selectedBot ? (
        <RoutineDialog
          bot={selectedBot}
          token={token}
          onClose={() => setRoutineOpen(false)}
          onSaved={async () => {
            setRoutineOpen(false)
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

function ProfileDialog({
  bot,
  token,
  onClose,
  onSaved,
}: {
  bot: BotTeammate
  token: string
  onClose: () => void
  onSaved: (botId: string) => Promise<void>
}) {
  const [name, setName] = useState(bot.name)
  const [title, setTitle] = useState(bot.title)
  const [description, setDescription] = useState(bot.description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      await api(`/api/bots/${bot.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ name, title, description }),
      })
      await onSaved(bot.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The profile could not be saved")
    } finally {
      setSaving(false)
    }
  }

  async function updateFlags(input: { pinned?: boolean; hidden?: boolean }) {
    setSaving(true)
    try {
      await api(`/api/bots/${bot.id}`, token, {
        method: "PATCH",
        body: JSON.stringify(input),
      })
      await onSaved(bot.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The teammate could not be updated")
      setSaving(false)
    }
  }

  async function duplicate() {
    setSaving(true)
    try {
      const created = await api<{ teammate: BotTeammate }>(`/api/bots/${bot.id}/duplicate`, token, {
        method: "POST",
      })
      await onSaved(created.teammate.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The teammate could not be duplicated")
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        <header>
          <div>
            <span className="connection-logo">
              <Bot size={20} />
            </span>
            <div>
              <p className="eyebrow">Teammate profile</p>
              <h2 id="profile-title">Edit {bot.name}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close profile dialog">
            <X size={17} />
          </button>
        </header>
        <form onSubmit={save}>
          <label htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
          />
          <label htmlFor="profile-title-input">Job</label>
          <input
            id="profile-title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            required
          />
          <label htmlFor="profile-description">Description</label>
          <textarea
            id="profile-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            maxLength={1000}
            required
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            Save profile
          </button>
        </form>
        <div className="profile-actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => void updateFlags({ pinned: !bot.pinned })}
          >
            <Pin size={13} /> {bot.pinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" disabled={saving} onClick={() => void duplicate()}>
            <Copy size={13} /> Duplicate
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void updateFlags({ hidden: !bot.hidden })}
          >
            {bot.hidden ? <Play size={13} /> : <Pause size={13} />}
            {bot.hidden ? "Restore" : "Archive"}
          </button>
        </div>
      </section>
    </div>
  )
}

function RoutineDialog({
  bot,
  token,
  onClose,
  onSaved,
}: {
  bot: BotTeammate
  token: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState("")
  const [prompt, setPrompt] = useState("")
  const [hours, setHours] = useState("24")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError("")
    try {
      const intervalMinutes = Math.round(Number(hours) * 60)
      await api(`/api/bots/${bot.id}/routines`, token, {
        method: "POST",
        body: JSON.stringify({ name, prompt, intervalMinutes }),
      })
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The routine could not be saved")
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
        aria-labelledby="routine-title"
      >
        <header>
          <div>
            <span className="connection-logo">
              <CalendarClock size={20} />
            </span>
            <div>
              <p className="eyebrow">Schedule work for {bot.name}</p>
              <h2 id="routine-title">New routine</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close routine dialog">
            <X size={17} />
          </button>
        </header>
        <p className="dialog-copy">
          HQBot runs the task on Cloudflare. Browser Run starts only when the routine needs it.
        </p>
        <form onSubmit={save}>
          <label htmlFor="routine-name">Name</label>
          <input
            id="routine-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Daily market brief"
            maxLength={100}
            required
          />
          <label htmlFor="routine-prompt">Task</label>
          <textarea
            id="routine-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Research the latest…"
            rows={4}
            maxLength={4000}
            required
          />
          <label htmlFor="routine-hours">Repeat every (hours)</label>
          <input
            id="routine-hours"
            type="number"
            min="0.25"
            max="720"
            step="0.25"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            required
          />
          {error ? <p className="form-error">{error}</p> : null}
          <button
            className="primary-button"
            type="submit"
            disabled={saving || !name.trim() || !prompt.trim()}
          >
            {saving ? <LoaderCircle className="spin" size={15} /> : <CalendarClock size={15} />}
            Create routine
          </button>
        </form>
      </section>
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
