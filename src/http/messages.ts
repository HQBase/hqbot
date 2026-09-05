import { messageSource, type SearchHit } from "../domain/messages";
import { json, readJson, teammate, workspace } from "./common";

export async function handleMessages(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!["/api/search", "/api/discussions"].includes(url.pathname)) return null;
  const agent = await workspace(env);
  if (url.pathname === "/api/search" && request.method === "GET") {
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (!query) return json({ hits: [], nextOffset: null, unavailable: [] });
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const bots = (await agent.getSnapshot()).bots;
    const hits: SearchHit[] = offset === 0 ? await agent.searchWorkspace(query) : [];
    const page = bots.slice(offset, offset + 10);
    const results = await Promise.allSettled(
      page.map(async (bot) => (await teammate(env, bot.id)).findMessages(query))
    );
    const unavailable: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") hits.push(...result.value);
      else unavailable.push(page[index]?.name ?? "Teammate");
    });
    return json({ hits, unavailable, nextOffset: offset + 10 < bots.length ? offset + 10 : null });
  }
  try {
    const body =
      request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request);
    const source = messageSource.parse(body);
    const content =
      source.kind === "bot"
        ? (await agent.hasBot(source.id))
          ? await (await teammate(env, source.id)).readMessageText(source.messageId)
          : null
        : await agent.projectMessage(source.id, source.messageId);
    if (content === null) return json({ error: "Message not found" }, 404);
    if (request.method === "GET")
      return json({ content, ...(await agent.readDiscussion(source, "owner")) });
    if (request.method === "POST")
      return json(
        body.action === "react"
          ? await agent.reactToMessage(source, "owner", body)
          : await agent.addDiscussionNote(source, "owner", {
              id: body.noteId,
              content: body.content
            })
      );
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : "The discussion could not load" },
      400
    );
  }
  return json({ error: "Unsupported message action" }, 400);
}
