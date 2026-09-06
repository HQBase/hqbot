import { HQBOT_MODELS } from "../../../domain/models";

const stamp = "2026-09-05T12:00:00.000Z";
const metadata = {
  revision: 2,
  source: "Reviewed with the owner",
  status: "ready",
  updatedAt: stamp,
  createdAt: stamp,
  botId: "researcher"
};
const items = [
  {
    ...metadata,
    id: "memory",
    kind: "memory",
    category: "preference",
    content: "Use official sources. Keep each update short and link to the evidence."
  },
  {
    ...metadata,
    id: "skill",
    kind: "skill",
    category: "method",
    name: "Weekly research brief",
    description: "A clear summary of changes, with checked sources and useful next steps.",
    instructions: "Collect primary sources. Compare changes. Write a short brief with links."
  },
  {
    ...metadata,
    id: "draft",
    kind: "skill",
    category: "method",
    status: "draft",
    revision: 1,
    name: "Review a support request",
    description: "A method from your demonstration. Ready for your review.",
    instructions: "Read the request. Check the account details. Draft a response for the owner."
  }
];
const projects = [
  {
    id: "launch",
    revision: 1,
    leadBotId: "researcher",
    name: "Launch preparation",
    description: "Research, support, and operations working from the same plan.",
    botIds: ["researcher", "support", "operator"],
    resources: [],
    createdAt: stamp,
    updatedAt: stamp
  }
];
const routines = [
  {
    id: "morning",
    botId: "researcher",
    name: "Morning brief",
    prompt: "Review official sources and prepare today's brief.",
    intervalMinutes: 60,
    active: true,
    nextRunAt: "2026-09-06T13:00:00Z",
    createdAt: stamp,
    revision: 1,
    schedule: {
      kind: "calendar",
      time: "09:00",
      days: [1, 2, 3, 4, 5],
      timezone: "America/Toronto"
    }
  }
];
export function installWorkspaceFixtures() {
  if (!import.meta.env.DEV) throw new Error("UI fixtures are for development only");
  window.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      location.origin
    );
    const method = init?.method ?? "GET";
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/"))
      return Response.json({ error: "The UI lab does not use the network" }, { status: 400 });
    if (method !== "GET")
      return Response.json({ error: "Preview only. No change was saved." }, { status: 400 });
    const path = url.pathname;
    let body: unknown;
    if (path.endsWith("/team-work"))
      body = {
        names: {
          researcher: "Researcher",
          support: "Support",
          operator: "Operator",
          writer: "Writer"
        },
        work: {
          id: "preview-team",
          ownerBotId: "researcher",
          projectId: "launch",
          goal: "Prepare a checked launch brief",
          criteria: ["Check the official source", "Review the support draft"],
          deadlineAt: "2026-09-06T15:00:00Z",
          budgetUsd: 1,
          spentUsd: 0.084,
          state: "waiting",
          result: null,
          createdAt: stamp,
          updatedAt: stamp,
          updates: [
            {
              id: "question:copy:limits",
              assignmentId: "source",
              senderBotId: "writer",
              recipientBotId: "operator",
              kind: "question",
              message: JSON.stringify({
                sourceAssignmentId: "copy",
                text: "Does the official source support the limits in our launch copy?"
              }),
              acknowledged: true,
              createdAt: stamp
            },
            {
              id: "answer:question:copy:limits",
              assignmentId: "copy",
              senderBotId: "operator",
              recipientBotId: "writer",
              kind: "answer",
              message:
                "Yes. The saved official source supports those limits. Keep the qualification about retries in the final copy.",
              acknowledged: true,
              createdAt: stamp
            }
          ],
          assignments: [
            {
              id: "copy",
              managerBotId: "researcher",
              depth: 1,
              modelId: HQBOT_MODELS[0].id,
              workId: "preview-team",
              key: "copy",
              botId: "writer",
              instruction: "Prepare the checked launch copy",
              criterion: "Use the verified source",
              state: "returned",
              result: "The draft includes the verified limits and retry qualification.",
              review: null,
              updatedAt: stamp
            },
            {
              id: "source",
              parentId: "draft",
              managerBotId: "support",
              depth: 2,
              modelId: HQBOT_MODELS[0].id,
              workId: "preview-team",
              key: "source",
              botId: "operator",
              instruction: "Check the current service limits",
              criterion: "Include an official source and the limits that affect launch",
              state: "reviewed",
              result: "The official service page confirms the limits used in the launch plan.",
              review: "Checked the linked page and compared each limit with the plan.",
              updatedAt: stamp
            },
            {
              id: "draft",
              managerBotId: "researcher",
              depth: 1,
              modelId: HQBOT_MODELS[0].id,
              waiting: true,
              progress: {
                summary: "The source check is complete. Reviewing the support draft.",
                nextStep: "Remove unsupported claims and return the checked draft.",
                blocked: false,
                updatedAt: stamp
              },
              workId: "preview-team",
              key: "draft",
              botId: "support",
              instruction: "Review the customer support draft",
              criterion: "Identify any unsupported claims",
              state: "submitted",
              result: null,
              review: null,
              updatedAt: stamp
            }
          ]
        }
      };
    else if (path.endsWith("/team-management"))
      body = {
        models: HQBOT_MODELS.filter((model) => model.rates),
        policy: {
          canManage: true,
          canCreate: false,
          canCreateManagers: false,
          allowedModelIds: [HQBOT_MODELS[0].id],
          defaultModelId: HQBOT_MODELS[0].id,
          maxEmployees: 8,
          maxConcurrent: 6,
          dailyBudgetUsd: 2
        }
      };
    else if (path.endsWith("/task-progress")) body = null;
    else if (path.endsWith("/actions"))
      body = {
        actions: [
          {
            id: "preview-action",
            executionId: "preview",
            seq: 1,
            connector: "Cloudflare Docs",
            method: "search_cloudflare_documentation",
            inputHash: "preview",
            args: { query: "service limits" },
            result: { source: "Official service limits", checked: true },
            state: "confirmed",
            createdAt: stamp,
            updatedAt: stamp
          }
        ]
      };
    else if (path === "/api/snapshot")
      body = {
        files: [],
        skills: items
          .filter((item) => item.kind === "skill" && item.status === "ready")
          .map((item) => ({
            ...item,
            id: `${url.searchParams.get("botId")}-${item.id}`,
            botId: url.searchParams.get("botId")
          }))
      };
    else if (path.endsWith("/knowledge")) body = { items };
    else if (path.endsWith("/demonstrations")) body = { demonstrations: [] };
    else if (path === "/api/projects") body = { projects };
    else if (path.endsWith("/resources")) body = { files: [], skills: [] };
    else if (path.endsWith("/messages")) body = { messages: [] };
    else if (path === "/api/search") body = { hits: [], nextOffset: null, unavailable: [] };
    else if (path === "/api/automations") body = { routines };
    else if (path === "/api/push/devices") body = { devices: [] };
    else if (path === "/api/models") body = { models: HQBOT_MODELS };
    else if (path.endsWith("/backups")) body = { backups: [], enabled: true };
    else if (path.endsWith("/computer-permissions")) body = { policy: "review", approvals: [] };
    else if (path.endsWith("/permission-rules")) body = { rules: [] };
    else if (path === "/api/local-devices") body = { devices: [], jobs: [] };
    else if (path === "/api/team/policy") body = { policy: { mode: "standard", origins: [] } };
    else if (path === "/api/team/admin") body = { users: [], invitations: [], projects, audit: [] };
    else if (path === "/api/templates/shares") body = { shares: [] };
    else body = {};
    return Response.json(body);
  };
}
