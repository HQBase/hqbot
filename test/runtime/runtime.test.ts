import type { ChatResponseResult } from "@cloudflare/think";
import type { LanguageModel, LanguageModelUsage, ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { estimateModelUsage } from "../../src/runtime/costs";
import { createHQBotModel } from "../../src/runtime/models";
import {
  createSubmittedChatMessage,
  finishTeammateResponse,
  prepareTeammateTurn,
  stopAfterBashHandoff,
  submitChatTurn,
  teammateInstructions
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

describe("agent turn", () => {
  function workspaceAgent(): WorkspaceAgentRpc {
    return {
      checkSpendPolicy: vi.fn(async () => ({ allowed: true, reason: null })),
      getBot: vi.fn(async () => null),
      listFiles: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      markInteraction: vi.fn(async () => undefined)
    } as unknown as WorkspaceAgentRpc;
  }

  it.each([
    "hey how are you?",
    "can you go log into X?",
    "Research the latest Cloudflare Agents changes"
  ])("leaves every registered tool available for: %s", async (message) => {
    const config = await prepareTeammateTurn({
      botId: "bot-1",
      connectedServices: ["GitHub"],
      context: { body: {}, messages: userMessage(message) } as never,
      maxSteps: Number.POSITIVE_INFINITY,
      modelFor: () => "test-model",
      workspaceAgent: workspaceAgent()
    });

    expect(config).not.toHaveProperty("activeTools");
    expect(config.maxSteps).toBe(Number.POSITIVE_INFINITY);
    expect(config.maxOutputTokens).toBe(5_000);
    expect(config.temperature).toBe(0.2);
    expect(config.instructions).not.toContain("Do not browse or use computer tools");
  });

  it("uses the teammate's saved finite step limit", async () => {
    const workspace = workspaceAgent();
    workspace.getBot = vi.fn(async () => ({
      brief: "Finish the request.",
      description: "A useful teammate.",
      id: "bot-1",
      maxSteps: 16,
      modelId: GLM_PRIMARY_MODEL_ID,
      name: "Teammate",
      title: "Teammate"
    }));

    const config = await prepareTeammateTurn({
      botId: "bot-1",
      connectedServices: [],
      context: { body: {}, messages: userMessage("Do the work") } as never,
      maxSteps: Number.POSITIVE_INFINITY,
      modelFor: () => "test-model",
      workspaceAgent: workspace
    });

    expect(config.maxSteps).toBe(16);
  });

  it("ends the Think turn after Bash hands work to Sandbox", async () => {
    expect(
      stopAfterBashHandoff({
        steps: [
          {
            toolResults: [
              {
                toolName: "bash",
                output: { processId: "process-1", type: "sandbox_process" }
              }
            ]
          }
        ] as never
      })
    ).toBe(true);
    expect(
      stopAfterBashHandoff({
        steps: [
          {
            toolResults: [
              {
                toolName: "bash",
                output: { exitCode: 0, type: "sandbox_command" }
              }
            ]
          }
        ] as never
      })
    ).toBe(false);
  });

  it("keeps the conversation title out of permanent model instructions", () => {
    const instructions = teammateInstructions({
      bot: {
        id: "bot-1",
        name: "Teammate",
        title: "hey how are you?",
        description: "A helpful teammate for everyday questions and tasks.",
        brief: "Answer the owner directly. Follow the instructions in the conversation.",
        maxSteps: null,
        modelId: DEEPSEEK_FALLBACK_MODEL_ID
      },
      connectedServices: [],
      memories: [],
      skills: []
    });

    expect(instructions).not.toContain("hey how are you?");
    expect(instructions).toContain("You are Teammate.");
    expect(instructions).toContain("Your selected model is DeepSeek V4 Flash.");
  });

  it("identifies attached durable files without exposing storage keys", () => {
    const instructions = teammateInstructions({
      attachedFileIds: ["file-1"],
      bot: null,
      connectedServices: [],
      files: [
        {
          id: "file-1",
          botId: "bot-1",
          taskId: null,
          key: "files/bot-1/secret-key/image.png",
          name: "image.png",
          contentType: "image/png",
          size: 42,
          createdAt: "2026-08-30T00:00:00.000Z"
        }
      ],
      memories: [],
      skills: []
    });

    expect(instructions).toContain("ID file-1: image.png (image/png, 42 bytes) [attached now]");
    expect(instructions).not.toContain("secret-key");
  });

  it("describes the complete Linux computer and safe owner-control handoff", () => {
    const instructions = teammateInstructions({
      bot: null,
      connectedServices: [],
      memories: [],
      skills: []
    });

    expect(instructions).toContain("Use any useful capability");
    expect(instructions).toContain("visible Chrome");
    expect(instructions).toContain("desktop_screenshot");
    expect(instructions).toContain("desktop_mouse");
    expect(instructions).toContain("desktop_keyboard");
    expect(instructions).toContain("browser_press");
    expect(instructions).toContain("never repeat the same failed call unchanged");
    expect(instructions).toContain("computer_session with give_to_owner");
    expect(instructions).toContain("computer_session with take_back");
    expect(instructions).toContain("Never ask for those secrets in chat");
    expect(instructions).toContain("Never search the computer for credentials");
    expect(instructions).toContain("Never read, export, copy, log, or save passwords, cookies");
    expect(instructions).toContain("copy_file_to_computer");
    expect(instructions).toContain("upload_file");
    expect(instructions).toContain("/workspace/hqbot");
    expect(instructions).toContain("file:///workspace/hqbot/report.html");
    expect(instructions).not.toContain("inputFileIds");
    expect(instructions).not.toContain("outputPaths");
    expect(instructions).not.toContain("HQBOT_OUTPUT_DIR");
  });

  it("starts durable task state only when later work is needed", () => {
    const instructions = teammateInstructions({
      bot: null,
      connectedServices: [],
      memories: [],
      skills: []
    });

    expect(instructions).toContain("Every owner message is a normal conversation turn");
    expect(instructions).toContain("reply normally and do not call manage_task");
    expect(instructions).toContain("work must continue in the next turn");
    expect(instructions).toContain("schedule with create_recurring");
    expect(instructions).not.toContain("Active task\n");
  });

  it("includes the durable checkpoint when a task is active", () => {
    const instructions = teammateInstructions({
      activeWork: {
        taskId: "task-1",
        goal: "Research Cloudflare schedules",
        checkpoint: "The official scheduling page is open.",
        state: "waiting",
        generation: 2,
        wakeAt: "2026-09-02T00:00:00.000Z",
        scheduleId: "schedule-1",
        submissionId: null,
        lastError: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:01:00.000Z"
      },
      bot: null,
      connectedServices: [],
      memories: [],
      skills: []
    });

    expect(instructions).toContain("Active task");
    expect(instructions).toContain("Research Cloudflare schedules");
    expect(instructions).toContain("The official scheduling page is open.");
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

  it("cancels the first submission when Stop lands during admission", async () => {
    const cancel = vi.fn(async () => undefined);
    const result = await submitChatTurn(
      { submissionId: "first:bot-1", prompt: "hey" },
      vi.fn(async () => ({ accepted: true, submissionId: "first:bot-1" })),
      {
        cancel,
        inspect: vi.fn(),
        messageApplied: vi.fn(),
        stopped: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
      }
    );

    expect(result).toBeNull();
    expect(cancel).toHaveBeenCalledWith("first:bot-1", "The owner stopped this teammate");
  });

  it("describes an idempotent retry whose message was not applied", async () => {
    const result = await submitChatTurn(
      { submissionId: "first:bot-1", prompt: "hey" },
      vi.fn(async () => ({ accepted: false, submissionId: "first:bot-1" })),
      {
        cancel: vi.fn(),
        inspect: vi.fn(async () => ({
          submissionId: "first:bot-1",
          status: "aborted" as const,
          error: "The owner stopped this teammate",
          createdAt: 1,
          completedAt: 2
        })),
        messageApplied: vi.fn(() => false),
        stopped: vi.fn(async () => false)
      }
    );

    expect(result).toEqual({
      accepted: false,
      submissionId: "first:bot-1",
      status: "aborted",
      error: "The owner stopped this teammate",
      messageApplied: false
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
      listFiles: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      markInteraction
    } as unknown as WorkspaceAgentRpc;

    await expect(
      prepareTeammateTurn({
        botId: "archived",
        connectedServices: [],
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
      listFiles: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      markInteraction: vi.fn(async () => undefined)
    } as unknown as WorkspaceAgentRpc;

    const config = await prepareTeammateTurn({
      botId: "bot-1",
      connectedServices: [],
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
      result: chatResponse("Finished the research.\nTwo sources agree."),
      workspaceAgent
    });

    expect(markInteraction).toHaveBeenCalledWith(
      "researcher",
      "Finished the research. Two sources agree.",
      "idle"
    );
  });

  it("can keep the teammate working after a bounded continuation", async () => {
    const markInteraction = vi.fn();
    const workspaceAgent = { markInteraction } as unknown as WorkspaceAgentRpc;

    await finishTeammateResponse({
      botId: "researcher",
      interactionStatus: "working",
      result: chatResponse("The task is complete."),
      workspaceAgent
    });

    expect(markInteraction).toHaveBeenCalledWith("researcher", "The task is complete.", "working");
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
  it("shows image tool results to the Workers AI model", async () => {
    type V4Model = Extract<LanguageModel, { specificationVersion: "v4" }>;
    const result = {
      content: [{ type: "text" as const, text: "I see the screenshot" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      },
      warnings: []
    };
    let received: Parameters<V4Model["doGenerate"]>[0] | undefined;
    const primaryGenerate: V4Model["doGenerate"] = vi.fn(async (params) => {
      received = params;
      return result;
    });
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
    const models: Record<string, V4Model> = {
      [GLM_PRIMARY_MODEL_ID]: model(GLM_PRIMARY_MODEL_ID, primaryGenerate),
      [DEEPSEEK_FALLBACK_MODEL_ID]: model(DEEPSEEK_FALLBACK_MODEL_ID, primaryGenerate)
    };
    const wrapped = createHQBotModel({
      resolve: (modelId) => models[modelId],
      onAttempt: () => undefined
    }) as V4Model;

    await wrapped.doGenerate({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "shot-1",
              toolName: "browser_screenshot",
              input: {}
            }
          ]
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "shot-1",
              toolName: "browser_screenshot",
              output: {
                type: "content",
                value: [
                  { type: "text", text: "Browser screenshot." },
                  {
                    type: "file",
                    filename: "browser-screenshot.jpg",
                    mediaType: "image/jpeg",
                    data: { type: "data", data: "aGVsbG8=" }
                  }
                ]
              }
            }
          ]
        }
      ]
    });

    expect(received?.prompt).toEqual([
      expect.objectContaining({ role: "assistant" }),
      {
        role: "tool",
        content: [
          expect.objectContaining({
            output: { type: "content", value: [{ type: "text", text: "Browser screenshot." }] }
          })
        ]
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Image output from the preceding tool." },
          {
            type: "file",
            filename: "browser-screenshot.jpg",
            mediaType: "image/jpeg",
            data: { type: "data", data: "aGVsbG8=" }
          }
        ]
      }
    ]);
  });

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
    const models: Record<string, V4Model> = {
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
    const models: Record<string, V4Model> = {
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
