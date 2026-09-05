import type { ToolSet } from "ai";
import { z } from "zod";
import { TeammateMessagesRuntime } from "./teammate-messages";

const teamActorKey = "hqbot:team-actor";
export abstract class TeammateTeamRuntime extends TeammateMessagesRuntime {
  protected override async assertAgentToolAllowed(name: string, input: unknown) {
    await super.assertAgentToolAllowed(name, input);
    const actor = await this.ctx.storage.get<string>(teamActorKey);
    if (actor && !(await this.workspaceAgent.canAccessBot(actor, this.name, true)))
      throw new Error("Team access was removed");
    if (actor && ["schedule", "manage_automation"].includes(name))
      throw new Error("The owner manages recurring routines and future schedules.");
  }
  protected protectTools(tools: ToolSet): ToolSet {
    return Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => {
        const execute = tool.execute;
        return [
          name,
          execute
            ? {
                ...tool,
                execute: async (input, context) => {
                  await this.assertAgentToolAllowed(name, input);
                  return execute(input, context);
                }
              }
            : tool
        ];
      })
    );
  }
  async teamConversation() {
    const history = await this.session.getRecentHistory(300000, 1);
    return {
      items: history.messages
        .filter((item) => ["user", "assistant"].includes(item.role))
        .map((item) => ({
          id: item.id,
          role: item.role,
          text: item.parts
            .filter((part) => part.type === "text")
            .map((part) => String(part.text ?? ""))
            .join("\n")
            .slice(0, 20000)
        })),
      truncated: history.truncated
    };
  }
  async submitTeamChat(userId: string, value: unknown) {
    const input = z
      .object({ id: z.uuid(), prompt: z.string().trim().min(1).max(12000) })
      .parse(value);
    if (!(await this.workspaceAgent.canAccessBot(userId, this.name, true)))
      throw new Error("Teammate access was removed");
    const id = `team:${userId}:${input.id}`;
    await this.submitMessages(
      [{ id, role: "user", parts: [{ type: "text", text: input.prompt }] }],
      { channel: "web", submissionId: id, idempotencyKey: id, metadata: { source: "team", userId } }
    );
    return { accepted: true, id };
  }
  protected override async assertProductTurnAllowed() {
    await super.assertProductTurnAllowed();
    const metadata = this.activeTurnMetadata as { source?: string; userId?: string } | null;
    if (metadata?.source === "team" && metadata.userId) {
      if (!(await this.workspaceAgent.canAccessBot(metadata.userId, this.name, true)))
        throw new Error("The member no longer has access to this teammate");
      await this.ctx.storage.put(teamActorKey, metadata.userId);
    } else if (!metadata?.source || metadata.source === "project" || metadata.source === "routine")
      await this.ctx.storage.delete(teamActorKey);
    if (!(await this.teamActorAllowed()))
      throw new Error(
        "The member's teammate access was removed. Ask the owner to review unfinished work."
      );
  }
  protected override collaborationRequester() {
    return this.ctx.storage.get<string>(teamActorKey);
  }
  private async teamActorAllowed() {
    const actor = await this.ctx.storage.get<string>(teamActorKey);
    return !actor || this.workspaceAgent.canAccessBot(actor, this.name, true);
  }
  protected override async canAct() {
    return (await super.canAct()) && (await this.teamActorAllowed());
  }
}
