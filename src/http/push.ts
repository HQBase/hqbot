import { pushDeviceInput } from "../domain/push";
import { cleanString, json, pathMatch, readJson, workspace } from "./common";

export async function handlePush(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const match = pathMatch(url.pathname, /^\/api\/push\/devices\/([^/]+)(\/test)?$/u);
  if (!["/api/push/configure", "/api/push/devices"].includes(url.pathname) && !match) return null;
  const agent = await workspace(env);
  try {
    if (url.pathname === "/api/push/configure" && request.method === "POST")
      return json(await agent.configureDevicePush(url.origin));
    if (url.pathname === "/api/push/devices") {
      if (request.method === "GET") return json({ devices: await agent.listPushDevices("owner") });
      if (request.method === "POST")
        return json({
          device: await agent.savePushDevice(
            "owner",
            pushDeviceInput.parse(await readJson(request))
          )
        });
    }
    if (match?.[0]) {
      if (match[1] && request.method === "POST") {
        await agent.testPushDevice(
          "owner",
          match[0],
          cleanString(await readJson(request), "id", 160)
        );
        return json({ queued: true }, 202);
      }
      if (!match[1] && request.method === "DELETE")
        return json({ deleted: await agent.removePushDevice("owner", match[0]) });
    }
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "Device settings could not be saved" },
      400
    );
  }
  return json({ error: "Unsupported push action" }, 400);
}
