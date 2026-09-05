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
    if (path.endsWith("/knowledge")) body = { items };
    else if (path.endsWith("/demonstrations")) body = { demonstrations: [] };
    else if (path === "/api/projects") body = { projects };
    else if (path.endsWith("/resources")) body = { files: [], skills: [] };
    else if (path.endsWith("/messages")) body = { messages: [] };
    else if (path === "/api/automations") body = { routines };
    else if (path === "/api/push/devices") body = { devices: [] };
    else if (path === "/api/models") body = { models: HQBOT_MODELS };
    else if (path.endsWith("/backups")) body = { backups: [], enabled: true };
    else if (path.endsWith("/computer-permissions"))
      body = { policy: { mode: "ask" }, pending: [] };
    else if (path.endsWith("/permission-rules")) body = { rules: [] };
    else if (path === "/api/local-devices") body = { devices: [], jobs: [] };
    else if (path === "/api/team/policy") body = { policy: { mode: "standard", origins: [] } };
    else if (path === "/api/team/admin") body = { users: [], invitations: [], projects, audit: [] };
    else if (path === "/api/templates/shares") body = { shares: [] };
    else body = {};
    return Response.json(body);
  };
}
