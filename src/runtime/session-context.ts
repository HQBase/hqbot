import type { Session } from "@cloudflare/think";
import { createCompactFunction } from "agents/experimental/memory/utils";

export function configureWorkSession(
  session: Session,
  summarize: (prompt: string) => Promise<string>
): Session {
  return session
    .onCompaction(
      createCompactFunction({
        summarize,
        protectHead: 2,
        tailTokenBudget: 8_000,
        minTailMessages: 2
      })
    )
    .compactAfter(18_000);
}
