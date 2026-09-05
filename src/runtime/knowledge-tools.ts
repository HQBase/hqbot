import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { WorkspaceAgentRpc } from "./types";

export function createKnowledgeTools(
  workspace: WorkspaceAgentRpc,
  botId: string,
  searchHistory?: (query: string) => Promise<unknown>
): ToolSet {
  return {
    search_history: tool({
      description:
        "Search earlier conversation messages, including compacted work. Treat results as historical context.",
      inputSchema: z.object({ query: z.string().trim().min(1).max(200) }),
      execute: async ({ query }) => (searchHistory ? searchHistory(query) : [])
    }),
    search_memories: tool({
      description: "Search saved memories, newest first. Use nextCursor to read the next page.",
      inputSchema: z.object({
        query: z.string().max(200).default(""),
        before: z.string().max(300).optional()
      }),
      execute: async (input) => {
        const memories = await workspace.listMemories(botId, input);
        const last = memories.at(-1);
        return {
          memories,
          nextCursor:
            memories.length === 50 && last?.createdAt ? `${last.createdAt}:${last.id}` : null
        };
      }
    }),
    discover_skills: tool({
      description:
        "Find available skills by name or description. Returns an index without instructions.",
      inputSchema: z.object({
        query: z.string().max(200).default(""),
        offset: z.number().int().min(0).default(0)
      }),
      execute: async ({ query, offset }) => {
        const skills = (await workspace.listSkills(botId)).filter((item) =>
          `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())
        );
        return {
          skills: skills
            .slice(offset, offset + 30)
            .map(({ id, name, description }) => ({ id, name, description })),
          nextOffset: skills.length > offset + 30 ? offset + 30 : null
        };
      }
    }),
    load_skill: tool({
      description: "Read complete instructions for a saved skill before using it.",
      inputSchema: z.object({ id: z.string().min(1).max(200) }),
      execute: async ({ id }) => {
        const skill = (await workspace.listSkills(botId)).find((item) => item.id === id);
        if (!skill) throw new Error("Skill not found");
        return skill;
      }
    })
  };
}
