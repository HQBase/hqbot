import type { ChatResponseResult } from "@cloudflare/think";
import type { LanguageModel, LanguageModelUsage, ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { estimateModelUsage } from "../../src/runtime/costs";
import { createHQBotModel } from "../../src/runtime/models";
import { activeTools, routeTurn, teammateInstructions } from "../../src/runtime/routing";
import {
  createSubmittedChatMessage,
  createSubmittedTaskMessage,
  finishTeammateResponse,
  prepareTeammateTurn
} from "../../src/runtime/turn";
import {
  DEEPSEEK_FALLBACK_MODEL_ID,
  GLM_PRIMARY_MODEL_ID,
  type HQBotModelId,
  type WorkspaceAgentRpc
} from "../../src/runtime/types";

function userMessage(text: string): ModelMessage[] {
  return [{ role: "user", content: text }];
}

function usage(): LanguageModelUsage {
  return {
    inputTokens: 1_000,
    inputTokenDetails: {
      noCacheTokens: 800,
      cacheReadTokens: 200,
      cacheWriteTokens: 0
    },
    outputTokens: 100,
    outputTokenDetails: {
      textTokens: 80,
      reasoningTokens: 20
    },
    totalTokens: 1_100
  };
}

function chatResponse(text: string, status: ChatResponseResult["status"] = "completed") {
  return {
    continuation: false,
    message: { id: "response", role: "assistant", parts: [{ type: "text", text }] },
    requestId: "request",
    status
  } satisfies ChatResponseResult;
}

describe("turn routing", () => {
  const browserTools = ["browser_execute", "browser_markdown"];

  it("keeps ordinary chat direct and tool-free", () => {
    const route = routeTurn({ messages: userMessage("Help me name this project") });

    expect(route).toBe("direct");
    expect(activeTools(route, browserTools)).toEqual([]);
  });

  it("answers a greeting without opening browser tools", () => {
    const route = routeTurn({ messages: userMessage("hey how are you?") });

    expect(route).toBe("direct");
    expect(activeTools(route, browserTools)).toEqual([]);
  });

  it("keeps the conversation title out of permanent model instructions", () => {
    const instructions = teammateInstructions({
      bot: {
        id: "bot-1",
        name: "Teammate",
        title: "hey how are you?",
        description: "A helpful teammate for everyday questions and tasks.",
        brief: "Answer the owner directly. Follow the instructions in the conversation.",
        modelId: DEEPSEEK_FALLBACK_MODEL_ID
      },
      connection: null,
      memories: [],
      skills: [],
      route: "direct"
    });

    expect(instructions).not.toContain("hey how are you?");
    expect(instructions).toContain("You are Teammate.");
    expect(instructions).toContain("Your selected model is DeepSeek V4 Flash.");
  });

  it("activates browser tools for research", () => {
    const route = routeTurn({
      messages: userMessage("Research the latest Cloudflare Agents changes")
    });
    const tools = activeTools(route, browserTools);

    expect(route).toBe("research");
    expect(tools).toContain("browser_execute");
    expect(tools).toContain("read");
    expect(tools).not.toContain("send_hqbase_reply");
  });

  it("keeps email research read-only and activates the reply approval tool", () => {
    const route = routeTurn({
      messages: userMessage("Please answer this request"),
      metadata: { source: "email" }
    });
    const tools = activeTools(route, browserTools);

    expect(route).toBe("email");
    expect(tools).toContain("browser_markdown");
    expect(tools).not.toContain("browser_execute");
    expect(tools).not.toContain("write");
    expect(tools).toContain("send_hqbase_reply");
  });

  it("does not browse for a model identity question", () => {
    const route = routeTurn({ messages: userMessage("That's awesome. Which model are you?") });
    const tools = activeTools(route, browserTools);

    expect(route).toBe("direct");
    expect(tools).not.toContain("browser_execute");
    expect(tools).not.toContain("browser_markdown");
  });

  it("keeps delegated research read-only and disables another delegation", () => {
    const route = routeTurn({
      messages: userMessage("[hqbot:email] Research the latest changes"),
      body: { delegation: true }
    });
    const tools = activeTools(route, browserTools, { readOnly: true });

    expect(route).toBe("research");
    expect(tools).toContain("browser_markdown");
    expect(tools).toContain("read");
    expect(tools).not.toContain("browser_execute");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("send_hqbase_reply");
    expect(tools).not.toContain("delegate_to_teammates");
  });

  it("activates delegation without forcing browser research", () => {
    const route = routeTurn({ messages: userMessage("Ask @Reviewer to check this draft") });
    const tools = activeTools(route, browserTools, { canDelegate: true });

    expect(route).toBe("direct");
    expect(tools).toEqual(["delegate_to_teammates"]);
  });
});

describe("durable task submission", () => {
  it("creates a native chat message without workspace-task metadata", () => {
    const { message, submissionId } = createSubmittedChatMessage({
      submissionId: "first:bot-1",
      prompt: "  hey how are you?  "
    });

    expect(submissionId).toBe("first:bot-1");
    expect(message).toEqual({
      id: "chat:first:bot-1",
      role: "user",
      parts: [{ type: "text", text: "hey how are you?" }]
    });
    expect(message).not.toHaveProperty("metadata");
  });

  it("carries server task metadata into Think lifecycle hooks", () => {
    const { message, metadata } = createSubmittedTaskMessage({
      taskId: "task-1",
      source: "email",
      prompt: "Research this request"
    });

    expect(metadata).toEqual({ taskId: "task-1", source: "email" });
    expect(message).toMatchObject({
      id: "task:task-1",
      metadata: { turnMetadata: metadata },
      parts: [{ type: "text", text: expect.stringContaining("Task ID: task-1") }]
    });
  });

  it("does not mark an archived teammate as working", async () => {
    const markInteraction = vi.fn();
    const workspaceAgent = {
      checkSpendPolicy: vi.fn(async () => ({
        allowed: false,
        reason: "Restore this teammate before you start new work"
      })),
      getBot: vi.fn(async () => null),
      getBotConnection: vi.fn(async () => null),
      listBots: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      markInteraction
    } as unknown as WorkspaceAgentRpc;

    await expect(
      prepareTeammateTurn({
        botId: "archived",
        browserTools: [],
        context: { body: {}, messages: [] } as never,
        maxSteps: 1,
        modelFor: () => "test-model",
        workspaceAgent
      })
    ).rejects.toThrow("Restore this teammate before you start new work");
    expect(markInteraction).not.toHaveBeenCalled();
  });

  it("uses the model saved on the teammate", async () => {
    const selectedModel = { modelId: "selected-model" } as unknown as LanguageModel;
    const modelFor = vi.fn(() => selectedModel);
    const workspaceAgent = {
      checkSpendPolicy: vi.fn(async () => ({ allowed: true, reason: null })),
      getBot: vi.fn(async () => ({
        id: "bot-1",
        name: "Teammate",
        title: "Research",
        description: "Finds useful evidence.",
        brief: "Be concise.",
        modelId: DEEPSEEK_FALLBACK_MODEL_ID
      })),
      getBotConnection: vi.fn(async () => null),
      listBots: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      markInteraction: vi.fn(async () => undefined)
    } as unknown as WorkspaceAgentRpc;

    const config = await prepareTeammateTurn({
      botId: "bot-1",
      browserTools: [],
      context: { body: {}, messages: userMessage("Hello") } as never,
      maxSteps: 1,
      modelFor,
      workspaceAgent
    });

    expect(modelFor).toHaveBeenCalledWith(DEEPSEEK_FALLBACK_MODEL_ID);
    expect(config.model).toBe(selectedModel);
  });
});

describe("turn completion", () => {
  it("returns native realtime chat to idle with the assistant summary", async () => {
    const markInteraction = vi.fn();
    const workspaceAgent = { markInteraction } as unknown as WorkspaceAgentRpc;

    await finishTeammateResponse({
      botId: "researcher",
      metadata: null,
      replyApproval: null,
      result: chatResponse("Finished the research.\nTwo sources agree."),
      workspaceAgent
    });

    expect(markInteraction).toHaveBeenCalledWith(
      "researcher",
      "Finished the research. Two sources agree.",
      "idle"
    );
  });

  it("fails a completed email task when no reply approval was produced", async () => {
    const failTask = vi.fn();
    const workspaceAgent = { failTask } as unknown as WorkspaceAgentRpc;

    await finishTeammateResponse({
      botId: "researcher",
      metadata: { source: "email", taskId: "task-1" },
      replyApproval: null,
      result: chatResponse("I researched the request but did not draft the reply."),
      workspaceAgent
    });

    expect(failTask).toHaveBeenCalledWith(
      "task-1",
      "The email task finished without producing a reply for approval"
    );
  });
});

describe("model cost estimates", () => {
  it.each([
    { model: GLM_PRIMARY_MODEL_ID, expectedMicroUsd: 176 },
    { model: DEEPSEEK_FALLBACK_MODEL_ID, expectedMicroUsd: 487 }
  ])("prices cached and uncached tokens for $model", ({ model, expectedMicroUsd }) => {
    const estimate = estimateModelUsage({
      botId: "researcher",
      taskId: "task-1",
      model,
      usage: usage(),
      occurredAt: "2026-08-30T12:00:00.000Z"
    });

    expect(estimate).toMatchObject({
      model,
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
      reasoningTokens: 20,
      estimatedCostMicroUsd: expectedMicroUsd
    });
  });
});

describe("model fallback", () => {
  it("uses DeepSeek when GLM rejects before generation", async () => {
    type V4Model = Extract<LanguageModel, { specificationVersion: "v4" }>;
    const result = {
      content: [{ type: "text" as const, text: "Fallback worked" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      },
      warnings: []
    };
    const primaryGenerate = vi.fn(async () => {
      throw new Error("GLM unavailable");
    });
    const fallbackGenerate = vi.fn(async () => result);
    const model = (id: HQBotModelId, generate: V4Model["doGenerate"]): V4Model => ({
      specificationVersion: "v4",
      provider: "test",
      modelId: id,
      supportedUrls: {},
      doGenerate: generate,
      doStream: async () => {
        throw new Error("Not used by this test");
      }
    });
    const models = {
      [GLM_PRIMARY_MODEL_ID]: model(GLM_PRIMARY_MODEL_ID, primaryGenerate),
      [DEEPSEEK_FALLBACK_MODEL_ID]: model(DEEPSEEK_FALLBACK_MODEL_ID, fallbackGenerate)
    };
    const attempts: HQBotModelId[] = [];
    const wrapped = createHQBotModel({
      resolve: (modelId) => models[modelId],
      onAttempt: (modelId) => attempts.push(modelId)
    }) as V4Model;

    await expect(wrapped.doGenerate({ prompt: [] })).resolves.toEqual(result);
    expect(primaryGenerate).toHaveBeenCalledOnce();
    expect(fallbackGenerate).toHaveBeenCalledOnce();
    expect(attempts).toEqual([GLM_PRIMARY_MODEL_ID, DEEPSEEK_FALLBACK_MODEL_ID]);
  });

  it("uses GLM as fallback when DeepSeek is selected", async () => {
    type V4Model = Extract<LanguageModel, { specificationVersion: "v4" }>;
    const result = {
      content: [{ type: "text" as const, text: "GLM fallback worked" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      },
      warnings: []
    };
    const deepSeekGenerate = vi.fn(async () => {
      throw new Error("DeepSeek unavailable");
    });
    const glmGenerate = vi.fn(async () => result);
    const model = (id: HQBotModelId, generate: V4Model["doGenerate"]): V4Model => ({
      specificationVersion: "v4",
      provider: "test",
      modelId: id,
      supportedUrls: {},
      doGenerate: generate,
      doStream: async () => {
        throw new Error("Not used by this test");
      }
    });
    const models = {
      [GLM_PRIMARY_MODEL_ID]: model(GLM_PRIMARY_MODEL_ID, glmGenerate),
      [DEEPSEEK_FALLBACK_MODEL_ID]: model(DEEPSEEK_FALLBACK_MODEL_ID, deepSeekGenerate)
    };
    const attempts: HQBotModelId[] = [];
    const wrapped = createHQBotModel({
      primaryModelId: DEEPSEEK_FALLBACK_MODEL_ID,
      resolve: (modelId) => models[modelId],
      onAttempt: (modelId) => attempts.push(modelId)
    }) as V4Model;

    await expect(wrapped.doGenerate({ prompt: [] })).resolves.toEqual(result);
    expect(attempts).toEqual([DEEPSEEK_FALLBACK_MODEL_ID, GLM_PRIMARY_MODEL_ID]);
  });
});
