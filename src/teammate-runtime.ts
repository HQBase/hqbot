import { Think } from "@cloudflare/think";
import type { LanguageModel } from "ai";
import { assertAgentToolPolicy, assertConnectorPolicy } from "./domain/admin-policy";
import type { PermissionRuleInput } from "./domain/permissions";
import { ActionHistory } from "./runtime/action-history";
import { TeammateComputer } from "./runtime/computer";
import { COMPUTER_ACTIONS, ComputerPermissions } from "./runtime/computer-permissions";
import type { ComputerSafety } from "./runtime/computer-safety";
import type { ComputerControlPayload, ComputerLeasePayload } from "./runtime/computer-types";
import { TeammateExternalEffects } from "./runtime/external-effects";
import {
  type LinuxProcessPollPayload,
  ManagedLinuxProcessSupervisor
} from "./runtime/managed-linux-process";
import { connectionList, mcpConnectorName } from "./runtime/mcp";
import { budgetedModel } from "./runtime/model-budget";
import { listHQBotModels, modelTokenRates } from "./runtime/model-catalog";
import { concreteLanguageModel, createHQBotModel } from "./runtime/models";
import type { OwnerHandoffs } from "./runtime/owner-handoff";
import { PermissionRules } from "./runtime/permission-rules";
import { TaskCoordinator } from "./runtime/task-coordinator";
import { TaskSupervision } from "./runtime/task-supervision";
import { TeammateIntegrations } from "./runtime/teammate-integrations";
import type { HQBotModelId, WorkspaceAgentRpc } from "./runtime/types";
import type { ActiveWork, WorkResumePayload } from "./runtime/work";
import { TeammateLinuxProcessStore, TeammateWorkStore } from "./runtime/work";
import type { Sql } from "./workspace/sql";

export const FIRST_MESSAGE_STOPPED_KEY = "hqbot:first-message-stopped";
const scheduleRetry = { maxAttempts: 5, baseDelayMs: 1_000, maxDelayMs: 10_000 };

export abstract class TeammateRuntime extends Think<Env> {
  private permissions: ComputerPermissions | null = null;
  private computer: TeammateComputer | null = null;
  private integrations: TeammateIntegrations | null = null;
  private linux: ManagedLinuxProcessSupervisor | null = null;
  private supervisor: TaskSupervision | null = null;
  private taskCoordinator: TaskCoordinator | null = null;

  private modelCatalog: ReturnType<typeof listHQBotModels> | null = null;

  protected modelFor(modelId: HQBotModelId): LanguageModel {
    return createHQBotModel({
      primaryModelId: modelId,
      resolve: (id) => this.budgetedModelFor(id, () => this.currentTaskId()),
      onAttempt: () => undefined
    });
  }
  protected budgetedModelFor(
    id: HQBotModelId,
    taskId: () => string | null
  ): Exclude<LanguageModel, string> {
    return budgetedModel({
      model: concreteLanguageModel(this.resolveModel(id)),
      modelId: id,
      botId: this.name,
      taskId,
      teamWorkId: () => this.currentTeamWorkId(),
      workspace: this.workspaceAgent,
      rates: async () => {
        this.modelCatalog ??= listHQBotModels(this.env.AI);
        return modelTokenRates(await this.modelCatalog, id);
      }
    });
  }

  abstract pollLinuxProcess(payload: LinuxProcessPollPayload): Promise<void>;
  abstract recoverRuntime(): Promise<void>;
  abstract resumeTask(payload: WorkResumePayload): Promise<void>;
  abstract settleComputer(payload: ComputerLeasePayload): Promise<void>;
  abstract settleComputerControl(payload: ComputerControlPayload): Promise<void>;

  protected get workspaceAgent(): WorkspaceAgentRpc {
    return this.env.HQBOT_AGENT.getByName(this.env.HQBOT_ID) as unknown as WorkspaceAgentRpc;
  }
  protected async assertAgentToolAllowed(name: string, _input: unknown): Promise<void> {
    assertAgentToolPolicy(await this.workspaceAgent.getAdminPolicy(), name);
  }
  protected async canAct(): Promise<boolean> {
    const bot = await this.workspaceAgent.getBot(this.name);
    return Boolean(bot && !bot.hidden);
  }

  protected async productContinuation(_id: string): Promise<void> {}

  protected get taskSupervision(): TaskSupervision {
    this.supervisor ??= new TaskSupervision(
      this.sql.bind(this) as Sql,
      async (id) => {
        const file = await this.workspaceAgent.getFile(id, this.name);
        return file && (await this.env.ARTIFACTS.head(file.key)) ? file : null;
      },
      () => this.integrationRuntime.history()
    );
    return this.supervisor;
  }

  protected get tasks(): TaskCoordinator {
    this.taskCoordinator ??= new TaskCoordinator({
      supervisor: this.taskSupervision,
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

  protected get computerPermissions(): ComputerPermissions {
    this.permissions ??= new ComputerPermissions(this.sql.bind(this) as Sql, {
      safety: this.computerSafety,
      pending: () => this.pendingApprovals(),
      authorize: (name, input) => this.assertAgentToolAllowed(name, input),
      permission: (action, input, fallback) =>
        this.permissionRules.decide("computer", action, input, fallback),
      beforeDecision: async (id, approved, automatic) => {
        const messageId = `computer-decision:${id}`;
        if (this.messages.some((message) => message.id === messageId)) return;
        const work = this.tasks.active();
        await this.addMessages([
          {
            id: messageId,
            role: "user",
            parts: [
              {
                type: "text",
                text: `${automatic ? "The owner’s computer policy allowed" : `The owner ${approved ? "approved" : "denied"}`} the exact computer action ${id}. Read the updated tool output in this conversation. This approval reference is not an action result ID. The output includes the saved actionId if you need read_action_result. Do not repeat the action.`
              }
            ],
            metadata: {
              turnMetadata: {
                source: "computer-decision",
                taskId: work?.taskId,
                generation: work?.generation
              }
            }
          }
        ]);
      },
      approve: (id) => this.approveExecution(id),
      reject: (id) => this.rejectExecution(id),
      isActive: () => this.canAct(),
      uncertain: () => this.tasks.markExternalEffectUncertain()
    });
    return this.permissions;
  }
  async restoreComputerBackup(id: string): Promise<void> {
    if (this.tasks.active()) throw new Error("Stop the active task before restoring a backup");
    await this.computerRuntime.restoreBackup(id);
  }
  saveComputerBackup(): Promise<void> {
    return this.computerRuntime.checkpoint();
  }

  getTaskProgress() {
    const work = this.tasks.current();
    return work
      ? {
          work,
          criteria: this.taskSupervision.criteria(work.taskId),
          milestones: this.taskSupervision.milestones(work.taskId)
        }
      : null;
  }

  private get permissionRules() {
    return new PermissionRules(this.sql.bind(this) as Sql, () => this.currentTaskId());
  }
  listPermissionRules() {
    return this.permissionRules.list();
  }
  listPermissionActions() {
    const state = this.getMcpServers();
    return [
      { connector: "computer", label: "Computer", actions: [...COMPUTER_ACTIONS] },
      ...Object.entries(state.servers).map(([id, server]) => ({
        connector: mcpConnectorName(id),
        label: server.name,
        actions: state.tools.filter((tool) => tool.serverId === id).map((tool) => tool.name)
      }))
    ];
  }
  savePermissionRule(input: PermissionRuleInput) {
    return this.permissionRules.save(input);
  }
  deletePermissionRule(id: string) {
    return this.permissionRules.remove(id);
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

  protected abstract get ownerHandoffs(): OwnerHandoffs;
  protected abstract get computerSafety(): ComputerSafety;

  protected async continueSavedAction(id: string, text: string) {
    await this.productContinuation(id);
    const work = this.tasks.active();
    const metadata = {
      source: "integration-result",
      integrationResultId: id,
      ...(work ? { taskId: work.taskId, generation: work.generation } : {})
    };
    await this.submitMessages(
      [
        {
          id,
          role: "user",
          parts: [
            {
              type: "text",
              text: `[hqbot:action-result]\n${text}\nContinue the owner's request. Verify the final result.`
            }
          ],
          metadata: { turnMetadata: metadata }
        }
      ],
      { channel: "web", idempotencyKey: id, submissionId: id, metadata }
    );
  }

  protected get integrationRuntime(): TeammateIntegrations {
    this.integrations ??= new TeammateIntegrations({
      authorizeServer: async (url) =>
        assertConnectorPolicy(await this.workspaceAgent.getAdminPolicy(), url),
      permission: (connector, action, input) =>
        this.permissionRules.decide(connector, action, input),
      history: new ActionHistory(this.sql.bind(this) as Sql),
      scheduleRecovery: async () => {
        await this.schedule(
          new Date(Date.now() + 60_000),
          "recoverRuntime",
          {},
          { idempotent: true, retry: scheduleRetry }
        );
      },
      continueTurn: (id, text) => this.continueSavedAction(id, text),
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
      isActive: () => this.canAct(),
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

  protected currentTeamWorkId(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  protected currentTaskId(): string | null {
    const metadataTaskId = this.activeTurnMetadata?.taskId;
    return typeof metadataTaskId === "string"
      ? metadataTaskId
      : (this.tasks.active()?.taskId ?? null);
  }

  protected async closeRuntimeResources(): Promise<void> {
    this.ownerHandoffs.cancel();
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
