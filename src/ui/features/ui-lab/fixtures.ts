import type { BotTeammate, CostSnapshot } from "../../../domain/types";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

export const labBots: BotTeammate[] = [
  {
    id: "researcher",
    name: "Researcher",
    title: "Web research",
    description: "I find current, cited answers and keep the useful parts short.",
    brief: "Research current questions with the browser.",
    pinned: true,
    hidden: false,
    status: "working",
    lastInteractedAt: minutesAgo(2),
    lastMessage: "Checking the official pricing page…",
    modelId: "@cf/zai-org/glm-5.3-flash",
    dailyBudgetUsd: 5,
    createdAt: minutesAgo(8_000),
    updatedAt: minutesAgo(2),
    connection: null
  },
  {
    id: "support",
    name: "Support",
    title: "Customer care",
    description: "I research support requests and prepare useful replies.",
    brief: "Help with support mail.",
    pinned: false,
    hidden: false,
    status: "needs_approval",
    lastInteractedAt: minutesAgo(18),
    lastMessage: "Reply ready for your approval",
    modelId: "@cf/zai-org/glm-5.3-flash",
    dailyBudgetUsd: 8,
    createdAt: minutesAgo(7_000),
    updatedAt: minutesAgo(18),
    connection: {
      id: "connection-support",
      provider: "hqbase",
      origin: "https://mail.example.com",
      mailboxId: "mailbox-support",
      mailboxAddress: "support@example.com",
      mailboxName: "Support",
      active: true,
      realtimeStatus: "connected",
      lastEventAt: minutesAgo(18),
      createdAt: minutesAgo(6_000)
    }
  },
  {
    id: "operator",
    name: "Operator",
    title: "Operations",
    description: "I keep routine work moving.",
    brief: "Handle operations tasks.",
    pinned: false,
    hidden: false,
    status: "idle",
    lastInteractedAt: minutesAgo(180),
    lastMessage: "Weekly check complete",
    modelId: "@cf/deepseek-ai/deepseek-v4-flash",
    dailyBudgetUsd: 3,
    createdAt: minutesAgo(5_000),
    updatedAt: minutesAgo(180),
    connection: null
  }
];

export const labArchivedBots: BotTeammate[] = [
  {
    id: "analyst",
    name: "Analyst",
    title: "Market analysis",
    description: "I turn current sources into short market notes.",
    brief: "Prepare cited market notes.",
    pinned: false,
    hidden: true,
    status: "idle",
    lastInteractedAt: minutesAgo(1_440),
    lastMessage: "Archived yesterday",
    modelId: "@cf/zai-org/glm-5.3-flash",
    dailyBudgetUsd: 2,
    createdAt: minutesAgo(12_000),
    updatedAt: minutesAgo(1_440),
    connection: null
  }
];

export const labCosts: CostSnapshot = {
  dayStartedAt: "2026-08-30T00:00:00.000Z",
  overall: { estimatedUsd: 1.24, inputUnits: 12_400, outputUnits: 3_200 },
  selectedBot: { estimatedUsd: 0.37, inputUnits: 4_800, outputUnits: 1_200 },
  selectedTask: { estimatedUsd: 0.002, inputUnits: 800, outputUnits: 240 },
  services: {
    overall: {
      browser: { estimatedUsd: 0.32, inputUnits: 880, outputUnits: 0 },
      workersAi: { estimatedUsd: 0.92, inputUnits: 12_400, outputUnits: 3_200 }
    },
    selectedBot: {
      browser: { estimatedUsd: 0.09, inputUnits: 96, outputUnits: 0 },
      workersAi: { estimatedUsd: 0.28, inputUnits: 4_800, outputUnits: 1_200 }
    },
    selectedTask: {
      browser: { estimatedUsd: 0.001, inputUnits: 1, outputUnits: 0 },
      workersAi: { estimatedUsd: 0.001, inputUnits: 800, outputUnits: 240 }
    }
  },
  platform: {
    durableObjectGbSecondsPerDay: 1_728.42,
    hqbaseRealtimeConnections: 2,
    selectedBotHqbaseRealtime: true,
    resources: {
      overall: {
        durableObjects: 4,
        agentSchedules: 8,
        taskSubmissionsToday: 10,
        r2FileObjects: 12,
        r2FileBytes: 4_096
      },
      selectedBot: {
        durableObjects: 1,
        agentSchedules: 3,
        taskSubmissionsToday: 4,
        r2FileObjects: 5,
        r2FileBytes: 2_048
      }
    }
  }
};
