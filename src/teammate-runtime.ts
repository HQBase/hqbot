import { Think } from "@cloudflare/think";
import { TeammateComputer } from "./runtime/computer";
import type { ComputerControlPayload, ComputerLeasePayload } from "./runtime/computer-types";
import { TeammateExternalEffects } from "./runtime/external-effects";
import {
  type LinuxProcessPollPayload,
  ManagedLinuxProcessSupervisor
} from "./runtime/managed-linux-process";
import { connectionList } from "./runtime/mcp";
import { TaskCoordinator } from "./runtime/task-coordinator";
import { TeammateIntegrations } from "./runtime/teammate-integrations";
import type { WorkspaceAgentRpc } from "./runtime/types";
import type { ActiveWork, WorkResumePayload } from "./runtime/work";
import { TeammateLinuxProcessStore, TeammateWorkStore } from "./runtime/work";
import type { Sql } from "./workspace/sql";

export const FIRST_MESSAGE_STOPPED_KEY = "hqbot:first-message-stopped";
const scheduleRetry = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 10_000 };

export abstract class TeammateRuntime extends Think<Env> {
  private computer: TeammateComputer | null = null;
  private integrations: TeammateIntegrations | null = null;
  private linux: ManagedLinuxProcessSupervisor | null = null;
  private taskCoordinator: TaskCoordinator | null = null;

  abstract pollLinuxProcess(payload: LinuxProcessPollPayload): Promise<void>;
  abstract recoverRuntime(): Promise<void>;
  abstract resumeTask(payload: WorkResumePayload): Promise<void>;
  abstract settleComputer(payload: ComputerLeasePayload): Promise<void>;
  abstract settleComputerControl(payload: ComputerControlPayload): Promise<void>;

  protected get workspaceAgent(): WorkspaceAgentRpc {
    return this.env.HQBOT_AGENT.getByName(this.env.HQBOT_ID) as unknown as WorkspaceAgentRpc;
  }

  protected get tasks(): TaskCoordinator {
    this.taskCoordinator ??= new TaskCoordinator({
      botId: this.name,
      cancelProcess: (current, cancelled) => this.processes.cancelWork(current, cancelled),
      cancelSchedule: (id) => this.cancelSchedule(id),
      cancelSubmission: (id, reason) => this.cancelSubmission(id, reason),
      getProcess: () => {
        const process = this.processes.current();
        return process
          ? {
              active: Boolean(this.processes.active()),
              generation: process.generation,
              hasResult: Boolean(process.result),
              taskId: process.taskId
            }
          : null;
      },
      getSchedule: (id) => this.getScheduleById(id),
      inspectSubmission: (id) => this.inspectSubmission(id),
      latestAssistantText: () => this.latestAssistantText(),
      // A retry can be created before Agents deletes the current one-shot row.
      scheduleResume: (when, payload) =>
        this.schedule(when, "resumeTask", payload, { idempotent: false, retry: scheduleRetry }),
      store: new TeammateWorkStore(this.sql.bind(this) as Sql),
      submitResume: (work, submissionId) => this.submitTaskResume(work, submissionId),
      teammateIsActive: async () => {
        const bot = await this.workspaceAgent.getBot(this.name);
        return Boolean(bot && !bot.hidden);
      },
      workspaceAgent: this.workspaceAgent
    });
    return this.taskCoordinator;
  }

  protected get processes(): ManagedLinuxProcessSupervisor {
    this.linux ??= new ManagedLinuxProcessSupervisor({
      addAssistantMessage: (id, text) => this.addAssistantMessage(id, text),
      botId: this.name,
      bucket: this.env.ARTIFACTS,
      cancelSchedule: (id) => this.cancelSchedule(id),
      computer: () => this.computerRuntime,
      isActiveTaskTurn: (work) =>
        this.activeTurnMetadata?.source === "active-task" &&
        this.activeTurnMetadata.taskId === work.taskId &&
        this.activeTurnMetadata.generation === work.generation,
      markInteraction: (summary) => this.workspaceAgent.markInteraction(this.name, summary, "idle"),
      processStore: new TeammateLinuxProcessStore(this.sql.bind(this) as Sql),
      schedulePoll: (when, payload) =>
        this.schedule(when, "pollLinuxProcess", payload, {
          idempotent: true,
          retry: scheduleRetry
        }),
      scheduleRecovery: (when) =>
        this.schedule(when, "recoverRuntime", {}, { idempotent: true, retry: scheduleRetry }),
      tasks: this.tasks,
      transactionSync: (closure) => this.ctx.storage.transactionSync(closure),
      workspaceAgent: this.workspaceAgent
    });
    return this.linux;
  }

  protected get computerRuntime(): TeammateComputer {
    this.computer ??= new TeammateComputer({
      botId: this.name,
      cancelSchedule: (id) => this.cancelSchedule(id),
      env: this.env,
      hasManagedProcess: () => Boolean(this.processes.active()),
      scheduleControl: (when, payload) =>
        this.schedule(when, "settleComputerControl", payload, {
          idempotent: true,
          retry: scheduleRetry
        }),
      scheduleSleep: (when, payload) =>
        this.schedule(when, "settleComputer", payload, { idempotent: true }),
      storage: this.ctx.storage,
      workspaceAgent: this.workspaceAgent
    });
    return this.computer;
  }

  protected get integrationRuntime(): TeammateIntegrations {
    this.integrations ??= new TeammateIntegrations({
      addAssistantMessage: (id, text) => this.addAssistantMessage(id, text),
      addServer: (name, url, token) =>
        this.addMcpServer(name, url, {
          transport: {
            type: "auto",
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {})
          }
        }),
      botId: this.name,
      ctx: this.ctx,
      effects: new TeammateExternalEffects(this.sql.bind(this) as Sql),
      env: this.env,
      isActive: async () => {
        const bot = await this.workspaceAgent.getBot(this.name);
        return Boolean(bot && !bot.hidden);
      },
      list: () => connectionList(this.getMcpServers()),
      loader: this.env.LOADER,
      markEffectUncertain: () => this.tasks.run(() => this.tasks.markExternalEffectUncertain()),
      markInteraction: (summary, status) =>
        this.workspaceAgent.markInteraction(this.name, summary, status),
      readyServers: () =>
        Object.entries(this.getMcpServers().servers).flatMap(([id, server]) => {
          if (server.state !== "ready") return [];
          const connection = this.mcp.mcpConnections[id];
          return connection ? [{ connection, id, name: server.name }] : [];
        }),
      removeServer: (id) => this.removeMcpServer(id),
      serverExists: (id) => Boolean(this.getMcpServers().servers[id])
    });
    return this.integrations;
  }

  protected currentTaskId(): string | null {
    const metadataTaskId = this.activeTurnMetadata?.taskId;
    return typeof metadataTaskId === "string"
      ? metadataTaskId
      : (this.tasks.active()?.taskId ?? null);
  }

  protected async closeRuntimeResources(): Promise<void> {
    await this.integrationRuntime.rejectAll();
    if (this.env.SANDBOX) await this.computerRuntime.stop();
    this.resetTurnState();
  }

  private async submitTaskResume(work: ActiveWork, submissionId: string) {
    const metadata = { source: "active-task", taskId: work.taskId, generation: work.generation };
    return this.submitMessages(
      [
        {
          id: submissionId,
          role: "user",
          parts: [
            {
              type: "text",
              text: `[hqbot:active-task]\nContinue the saved task.\n\nGoal: ${work.goal}\n\nCheckpoint: ${work.checkpoint}`
            }
          ],
          metadata: { turnMetadata: metadata }
        }
      ],
      { channel: "web", idempotencyKey: submissionId, metadata, submissionId }
    );
  }

  private latestAssistantText(): string {
    const message = [...this.messages]
      .reverse()
      .find((candidate) => candidate.role === "assistant");
    return (
      message?.parts
        .filter(
          (part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
            part.type === "text"
        )
        .map((part) => part.text)
        .join("\n")
        .trim() ?? ""
    );
  }

  private async addAssistantMessage(id: string, text: string): Promise<void> {
    if (this.messages.some((message) => message.id === id)) return;
    await this.addMessages([{ id, role: "assistant", parts: [{ type: "text", text }] }]);
  }
}
