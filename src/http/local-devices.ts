import { z } from "zod";
import { json, pathMatch, readJson, workspace } from "./common";

export async function handleLocalDevices(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/local-devices")) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/local-devices" && request.method === "GET")
      return json({ devices: await agent.listLocalDevices(), jobs: await agent.localJobs() });
    if (url.pathname === "/api/local-devices/pair" && request.method === "POST") {
      const input = z
        .object({ botIds: z.array(z.string().min(1).max(200)).min(1).max(12) })
        .parse(await readJson(request));
      return json(await agent.createLocalPairing(input.botIds), 201);
    }
    const match = pathMatch(url.pathname, /^\/api\/local-devices\/([^/]+)$/u);
    if (match?.[0] && request.method === "DELETE") {
      await agent.revokeLocalDevice(match[0]);
      return json({ revoked: true });
    }
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : "Device change failed" }, 400);
  }
  return null;
}
export async function handleLocalClient(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/local-client/")) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/local-client/pair" && request.method === "POST") {
      const input = z
        .object({ code: z.string().min(32).max(100), name: z.string().trim().min(1).max(80) })
        .parse(await readJson(request));
      return json(await agent.pairLocalDevice(input.code, input.name), 201);
    }
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{32,100})$/u)?.[1];
    const deviceId = token ? await agent.identifyLocalDevice(token) : null;
    if (!deviceId) return json({ error: "Device pairing is required" }, 401);
    if (url.pathname === "/api/local-client/unpair" && request.method === "POST") {
      await agent.revokeLocalDevice(deviceId);
      return json({ revoked: true });
    }
    const jobPath = pathMatch(url.pathname, /^\/api\/local-client\/jobs\/([^/]+)$/u);
    if (jobPath?.[0] && request.method === "GET")
      return json({ job: await agent.deviceLocalJob(deviceId, jobPath[0]) });
    if (url.pathname === "/api/local-client/jobs" && request.method === "GET")
      return json({ jobs: await agent.pollLocalDevice(deviceId) });
    if (request.method === "POST") {
      const body = await readJson(request);
      if (url.pathname === "/api/local-client/result")
        return json({ job: await agent.finishLocalJob(deviceId, body) });
      const input = z.object({ id: z.string().min(1).max(300), claimId: z.uuid() }).parse(body);
      if (url.pathname === "/api/local-client/claim")
        return json({ job: await agent.claimLocalJob(deviceId, input.id, input.claimId) });
      if (url.pathname === "/api/local-client/start")
        return json(await agent.startLocalJob(deviceId, input.id, input.claimId));
    }
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "Local command could not continue" },
      409
    );
  }
  return json({ error: "Unknown local client action" }, 404);
}
