import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { type KnowledgeRpc, knowledgeWrite } from "../domain/knowledge";

export function knowledgeManagement(workspace: KnowledgeRpc, botId: string): ToolSet {
  return {
    manage_knowledge: tool({
      description:
        "Read, save, revise, or forget your own lasting memories and reusable skills. Save explicit owner preferences and verified facts; never save passwords, tokens, cookies, or unverified claims. Include the source message or task ID. Read an entry to obtain its revision before editing. New skills start as drafts; set ready only after testing the method. Forget only when the owner asks or a fact is known to be false. Forget removes its saved revision history too.",
      inputSchema: z.discriminatedUnion("action", [
        z.object({
          action: z.literal("list"),
          query: z.string().max(200).default(""),
          offset: z.number().int().min(0).default(0)
        }),
        z.object({ action: z.literal("read"), id: z.string().min(1).max(200) }),
        z.object({ action: z.literal("save"), entry: knowledgeWrite }),
        z.object({
          action: z.literal("forget"),
          kind: z.enum(["memory", "skill"]),
          id: z.string().min(1).max(200)
        })
      ]),
      execute: async (input, context) => {
        if (input.action === "save")
          return workspace.saveKnowledge(botId, `knowledge:${context.toolCallId}`, input.entry);
        if (input.action === "forget")
          return { forgotten: await workspace.forgetKnowledge(botId, input.kind, input.id) };
        const items = await workspace.listKnowledge(botId);
        if (input.action === "read") {
          const item = items.find((item) => item.id === input.id);
          if (!item) throw new Error("Knowledge entry not found");
          return item;
        }
        const matches = items.filter((item) =>
          (item.kind === "memory" ? item.content : `${item.name} ${item.description}`)
            .toLocaleLowerCase()
            .includes(input.query.toLocaleLowerCase())
        );
        return {
          items: matches
            .slice(input.offset, input.offset + 30)
            .map((item) => (item.kind === "skill" ? { ...item, instructions: undefined } : item)),
          nextOffset: matches.length > input.offset + 30 ? input.offset + 30 : null
        };
      }
    })
  };
}
