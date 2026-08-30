import { describe, expect, it, vi } from "vitest";

import {
  boundedDelegatedTask,
  delegatedTaskPrompt,
  delegateToNamedTeammates,
  delegationInstructions,
  executeDelegatedTask
} from "../../src/runtime/collaboration";
import type { WorkspaceTeammateDto } from "../../src/runtime/types";

function teammate(id: string, name: string, hidden = false): WorkspaceTeammateDto {
  return {
    id,
    name,
    title: "Specialist",
    description: "Helps with a bounded task.",
    brief: "Be concise.",
    hidden
  };
}

describe("teammate delegation", () => {
  it("calls only named existing teammates and combines their reports", async () => {
    const bots = [
      teammate("lead", "Lead"),
      teammate("research", "Research"),
      teammate("review", "Review"),
      teammate("hidden", "Hidden", true)
    ];
    const delegate = vi.fn(async (target: WorkspaceTeammateDto, task: string) => ({
      botId: target.id,
      name: target.name,
      report: `${target.name} completed: ${task}`
    }));
    const result = await delegateToNamedTeammates({
      prompt: "Ask @Review and @Research. Also @Hidden and @Unknown.",
      task: "Check the evidence",
      currentBotId: "lead",
      listBots: async () => bots,
      delegate
    });

    expect(delegate.mock.calls.map(([target]) => target.id)).toEqual(["review", "research"]);
    expect(result).toContain("### Review\nReview completed: Check the evidence");
    expect(result).toContain("### Research\nResearch completed: Check the evidence");
    expect(result).not.toContain("### Hidden");
  });

  it("rejects a call when the user did not name an available teammate", async () => {
    await expect(
      delegateToNamedTeammates({
        prompt: "Ask an expert to check this",
        task: "Check the evidence",
        currentBotId: "lead",
        listBots: async () => [teammate("lead", "Lead"), teammate("research", "Research")],
        delegate: vi.fn()
      })
    ).rejects.toThrow("does not name an available teammate");
  });

  it("runs a delegated turn only between visible existing teammates", async () => {
    const run = vi.fn(async (_prompt: string, _signal: AbortSignal) => ({
      status: "completed",
      message: { parts: [{ type: "text", text: "Useful report" }] }
    }));
    const result = await executeDelegatedTask(
      { requesterId: "lead", task: "Check the evidence" },
      {
        targetId: "review",
        listBots: async () => [teammate("lead", "Lead"), teammate("review", "Review")],
        run
      }
    );

    expect(result).toEqual({ botId: "review", name: "Review", report: "Useful report" });
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[0]).toContain("Do not send, publish");
    expect(run.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("marks delegated work as bounded, read-only, and loop-free", () => {
    const prompt = delegatedTaskPrompt("Lead", "Check the evidence");
    expect(prompt).toContain("one bounded subtask");
    expect(prompt).toContain("read-only");
    expect(prompt).toContain("Do not send, publish, submit forms, change data, or delegate again");
    expect(delegationInstructions([teammate("research", "Research")])).toContain(
      "Call delegate_to_teammates once"
    );
    expect(boundedDelegatedTask("  Check the evidence  ")).toBe("Check the evidence");
    expect(() => boundedDelegatedTask(" ")).toThrow("must contain 1 to 5000 characters");
  });
});
