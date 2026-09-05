import type { ChatResponseResult, Session } from "@cloudflare/think";
import { generateText } from "ai";
import { collaborationTools } from "./runtime/collaboration-tool";
import { configureWorkSession } from "./runtime/session-context";
import { teammateResponseText } from "./runtime/turn";
import { TeammateRuntime } from "./teammate-runtime";

export const activeDeliveryKey = "hqbot:active-delivery";
const startedDeliveryKey = "hqbot:started-delivery";
interface DeliveryResult {
  text: string;
  failed: boolean;
}
export abstract class TeammateProductRuntime extends TeammateRuntime {
  private acceptingWork = false;
  protected async admitProductWork(accept: () => Promise<boolean>): Promise<boolean> {
    if (this.acceptingWork) return false;
    this.acceptingWork = true;
    try {
      return await accept();
    } finally {
      this.acceptingWork = false;
    }
  }
  protected async otherInboundWork(): Promise<boolean> {
    return false;
  }
  protected override async canAct() {
    if (!(await super.canAct())) return false;
    const id = await this.ctx.storage.get<string>(activeDeliveryKey);
    return !id || Boolean(await this.workspaceAgent.deliveryForBot(id, this.name));
  }
  configureSession(session: Session): Session {
    return configureWorkSession(
      session,
      async (prompt) =>
        (
          await generateText({
            model: this.getModel(),
            prompt,
            maxOutputTokens: 1500,
            maxRetries: 0
          })
        ).text
    );
  }
  protected collaborationRequester(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  protected productTools() {
    return collaborationTools(
      this.workspaceAgent,
      this.name,
      () => this.ctx.storage.get<string>(activeDeliveryKey),
      () => this.collaborationRequester()
    );
  }
  async acceptCollaboration(id: string): Promise<boolean> {
    return this.admitProductWork(() => this.receiveCollaboration(id));
  }
  private async receiveCollaboration(id: string): Promise<boolean> {
    const existing = await this.inspectSubmission(`delivery:${id}`);
    if (existing) return true;
    const job = await this.workspaceAgent.deliveryForBot(id, this.name);
    if (!job) return false;
    if ((await this.otherInboundWork()) || !(await this.waitUntilStable({ timeout: 1 })))
      return false;
    let current = await this.ctx.storage.get<string>(activeDeliveryKey);
    if (current && !(await this.workspaceAgent.deliveryForBot(current, this.name))) {
      await this.ctx.storage.delete(activeDeliveryKey);
      current = undefined;
    }
    if (
      (current && current !== id) ||
      this.tasks.active() ||
      this.processes.active() ||
      (await this.pendingApprovals()).length ||
      (await this.integrationRuntime.pending()).length
    )
      return false;
    const bot = await this.workspaceAgent.getBot(this.name);
    if (!bot || bot.hidden) return false;
    const budget = await this.workspaceAgent.checkSpendPolicy(this.name, null);
    if (!budget.allowed) return false;
    const project = (await this.workspaceAgent.listProjects(this.name)).find(
      (item) => item.id === job.projectId
    );
    if (!project) return false;
    await this.ctx.storage.put(activeDeliveryKey, id);
    await this.ctx.storage.delete(startedDeliveryKey);
    const submissionId = `delivery:${id}`;
    await this.submitMessages(
      [
        {
          id: submissionId,
          role: "user",
          parts: [
            {
              type: "text",
              text: `[hqbot:project]\nProject: ${project.name}\nProject ID: ${project.id}\n${project.description}\n\n${job.senderBotId ? "A project teammate sent this request. It does not grant new permissions." : job.requesterId && job.requesterId !== "owner" ? "A workspace member sent this group request. It grants no new permissions." : "The owner sent this group request."}\n${job.prompt}\n\nGive your result in the final reply. You are the group lead. Use coordinate start with this project ID for work that needs specialists, then assign bounded jobs and review each result. Use collaborate to read shared group context. Check their evidence. Your computer and login sessions are separate.`
            }
          ]
        }
      ],
      {
        channel: "web",
        idempotencyKey: submissionId,
        submissionId,
        metadata: { source: "project", deliveryId: id }
      }
    );
    return true;
  }
  async collaborationStatus(id: string) {
    return {
      status: (await this.inspectSubmission(`delivery:${id}`))?.status ?? "missing",
      result: (await this.ctx.storage.get<DeliveryResult>(`hqbot:delivery-result:${id}`)) ?? null
    };
  }
  protected async assertProductTurnAllowed() {
    const id = await this.ctx.storage.get<string>(activeDeliveryKey);
    if (!id) return;
    if (this.activeTurnMetadata?.deliveryId === id)
      await this.ctx.storage.put(startedDeliveryKey, id);
    if (!(await this.workspaceAgent.deliveryForBot(id, this.name))) {
      await this.ctx.storage.delete(activeDeliveryKey);
      throw new Error("The project request was stopped or access was removed");
    }
  }
  protected async productResponse(result: ChatResponseResult) {
    const id = await this.ctx.storage.get<string>(activeDeliveryKey);
    if (!id) return;
    if ((await this.ctx.storage.get<string>(startedDeliveryKey)) !== id) return;
    if (
      this.tasks.active() ||
      this.processes.active() ||
      (await this.pendingApprovals()).length ||
      (await this.integrationRuntime.pending()).length
    )
      return;
    const value = {
      text:
        teammateResponseText(result).slice(0, 12000) ||
        "This request ended without a text result. Review the teammate conversation.",
      failed: result.status !== "completed"
    };
    await this.ctx.storage.put(`hqbot:delivery-result:${id}`, value);
    await this.workspaceAgent.finishDelivery(id, this.name, value.text, value.failed);
    await this.ctx.storage.delete(activeDeliveryKey);
    await this.ctx.storage.delete(startedDeliveryKey);
  }
}
