import { Agent, type Connection } from "agents";

import type {
  BotDefinition,
  BotFile,
  BotMemory,
  BotRoutine,
  BotSkill,
  BotTask,
  BotTeammate,
  StoredComputerState,
  UsageInput,
  WorkspaceSnapshot
} from "../domain/types";
import type { ModelUsageDto, ResourceUsageDto } from "../runtime/types";
import { WorkspaceAuth } from "./auth";
import { checkSpendPolicy, positiveNumber } from "./budgets";
import { WorkspaceCatalog } from "./catalog";
import { migrateWorkspace } from "./migrations";
import { readWorkspaceSnapshot } from "./snapshot";
import type { Sql } from "./sql";
import { WorkspaceTasks } from "./tasks";

export class WorkspaceAgentBase extends Agent<Env, Record<string, never>> {
  protected get db(): Sql {
    return this.sql.bind(this) as Sql;
  }

  protected get catalog(): WorkspaceCatalog {
    return new WorkspaceCatalog(this.db);
  }

  protected get tasks(): WorkspaceTasks {
    return new WorkspaceTasks(this.db);
  }

  private get auth(): WorkspaceAuth {
    return new WorkspaceAuth(this.db);
  }

  async onStart(): Promise<void> {
    migrateWorkspace(this.db);
  }

  onConnect(connection: Connection): void {
    connection.send(JSON.stringify({ type: "changed" }));
  }

  protected changed(): void {
    this.broadcast(JSON.stringify({ type: "changed" }));
  }

  hasOwner(): boolean {
    return this.auth.hasOwner();
  }

  bootstrapOwner(username: string, password: string): Promise<string> {
    return this.auth.bootstrap(username, password);
  }

  loginOwner(username: string, password: string, attemptKey: string) {
    return this.auth.login(username, password, attemptKey);
  }

  validateOwnerSession(token: string): Promise<boolean> {
    return this.auth.validateSession(token);
  }

  logoutOwner(token: string): Promise<void> {
    return this.auth.logout(token);
  }

  createBot(id: string, definition: BotDefinition, brief: string): BotTeammate {
    const bot = this.catalog.createBot(
      id,
      definition,
      brief,
      this.env.HQBOT_MODEL_ID,
      positiveNumber(this.env.HQBOT_BOT_DAILY_BUDGET_USD, 2)
    );
    this.changed();
    return bot;
  }

  hasBot(id: string): boolean {
    return this.catalog.hasBot(id);
  }

  listBots(): BotTeammate[] {
    return this.catalog.listBots();
  }

  getBot(id: string): BotTeammate | null {
    return this.catalog.getBot(id);
  }

  updateBot(id: string, input: Parameters<WorkspaceCatalog["updateBot"]>[1]): BotTeammate | null {
    const bot = this.catalog.updateBot(id, input);
    if (bot) this.changed();
    return bot;
  }

  markInteraction(
    botId: string,
    occurredAtOrMessage: string,
    status: "working" | "idle" = "working"
  ): void {
    const current = this.catalog.getBot(botId);
    const isTimestamp = !Number.isNaN(Date.parse(occurredAtOrMessage));
    this.catalog.markInteraction(
      botId,
      isTimestamp ? (current?.lastMessage ?? "Active now") : occurredAtOrMessage,
      status
    );
    this.changed();
  }

  createMemory(id: string, botId: string, content: string): BotMemory {
    const memory = this.catalog.createMemory(id, botId, content);
    this.changed();
    return memory;
  }

  listMemories(botId: string): BotMemory[] {
    return this.catalog.listMemories(botId);
  }

  deleteMemory(id: string, botId: string): boolean {
    const deleted = this.catalog.deleteMemory(id, botId);
    if (deleted) this.changed();
    return deleted;
  }

  createRoutine(input: Parameters<WorkspaceCatalog["createRoutine"]>[0]): BotRoutine {
    const routine = this.catalog.createRoutine(input);
    this.changed();
    return routine;
  }

  listRoutines(botId: string): BotRoutine[] {
    return this.catalog.listRoutines(botId);
  }

  setRoutineActive(id: string, botId: string, active: boolean): BotRoutine | null {
    const routine = this.catalog.setRoutineActive(id, botId, active);
    if (routine) this.changed();
    return routine;
  }

  deleteRoutine(id: string, botId: string): boolean {
    const deleted = this.catalog.deleteRoutine(id, botId);
    if (deleted) this.changed();
    return deleted;
  }

  createFile(input: Parameters<WorkspaceCatalog["createFile"]>[0]): BotFile {
    const file = this.catalog.createFile(input);
    this.changed();
    return file;
  }

  attachFiles(botId: string, taskId: string, fileIds: string[]): BotFile[] {
    return this.catalog.attachFiles(botId, taskId, fileIds);
  }

  deleteFile(id: string, botId: string): BotFile | null {
    const file = this.catalog.deleteFile(id, botId);
    if (file) this.changed();
    return file;
  }

  createSkill(input: Parameters<WorkspaceCatalog["createSkill"]>[0]): BotSkill {
    const skill = this.catalog.createSkill(input);
    this.changed();
    return skill;
  }

  listSkills(botId: string): BotSkill[] {
    return this.catalog.listSkills(botId);
  }

  deleteSkill(id: string, botId: string): boolean {
    const deleted = this.catalog.deleteSkill(id, botId);
    if (deleted) this.changed();
    return deleted;
  }

  saveComputerState(input: Omit<StoredComputerState, "active" | "updatedAt">): void {
    this.catalog.saveComputerState(input);
    this.changed();
  }

  createChatTask(id: string, botId: string, prompt: string): void {
    this.tasks.createChatTask(id, botId, prompt);
    this.catalog.markInteraction(botId, prompt, "working");
    this.changed();
  }

  checkSpendPolicy(
    botId: string,
    taskId: string | null
  ): { allowed: boolean; reason: string | null } {
    return checkSpendPolicy(this.env, this.catalog, this.tasks, botId, taskId);
  }

  getTask(taskId: string): BotTask | null {
    return this.tasks.getTask(taskId);
  }

  requestReplyApproval(taskId: string, draft: string): boolean {
    if (!this.tasks.requestReplyApproval(taskId, draft)) return false;
    const task = this.tasks.getTask(taskId);
    if (task) this.catalog.markInteraction(task.botId, "Reply needs approval", "needs_approval");
    this.changed();
    return true;
  }

  claimApprovedReply(taskId: string, draft: string): boolean {
    if (!this.tasks.claimApprovedReply(taskId, draft)) return false;
    this.tasks.recordReplyDecision(taskId, true);
    const task = this.tasks.getTask(taskId);
    if (task) this.catalog.markInteraction(task.botId, "Sending approved reply", "working");
    this.changed();
    return true;
  }

  rejectReply(taskId: string): boolean {
    const task = this.tasks.getTask(taskId);
    if (!task || !this.tasks.rejectReply(taskId)) return false;
    this.tasks.recordReplyDecision(taskId, false);
    this.catalog.markInteraction(task.botId, "Reply kept as a draft", "idle");
    this.changed();
    return true;
  }

  completeTask(taskId: string, result: string, replyMessageId: string | null): void {
    this.tasks.completeTask(taskId, result, replyMessageId);
    const task = this.tasks.getTask(taskId);
    if (task) this.catalog.markInteraction(task.botId, result, "idle");
    this.changed();
  }

  failTask(taskId: string, error: string): void {
    this.tasks.failTask(taskId, error);
    const task = this.tasks.getTask(taskId);
    if (task) this.catalog.markInteraction(task.botId, "Task failed", "idle");
    this.changed();
  }

  cancelTask(taskId: string): boolean {
    if (!this.tasks.cancelTask(taskId)) return false;
    const task = this.tasks.getTask(taskId);
    if (task) this.catalog.markInteraction(task.botId, "Task stopped", "idle");
    this.changed();
    return true;
  }

  recordUsage(usage: ModelUsageDto | UsageInput): void {
    const input: UsageInput =
      "estimatedCostMicroUsd" in usage
        ? {
            id: crypto.randomUUID(),
            botId: usage.botId,
            taskId: usage.taskId,
            service: "workers-ai",
            inputUnits: usage.inputTokens,
            outputUnits: usage.outputTokens,
            estimatedUsd: usage.estimatedCostMicroUsd / 1_000_000
          }
        : usage;
    this.tasks.recordUsage(input);
    this.changed();
  }

  recordResourceUsage(usage: ResourceUsageDto): void {
    this.tasks.recordUsage({
      id: crypto.randomUUID(),
      botId: usage.botId,
      taskId: usage.taskId,
      service: usage.service,
      inputUnits: usage.service === "browser" ? Math.ceil(usage.units / 1_000) : usage.units,
      estimatedUsd: usage.estimatedCostMicroUsd / 1_000_000
    });
    this.changed();
  }

  getSnapshot(botId?: string): WorkspaceSnapshot {
    return readWorkspaceSnapshot(this.catalog, this.tasks, botId);
  }
}
