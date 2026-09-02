import { clearChatTerminal, pendingChatTerminal } from "agents/chat";

const LEGACY_SCREENSHOT_REPLAY_ERROR = "atob() called with invalid base64-encoded data.";

export async function clearLegacyScreenshotReplayError(
  storage: Parameters<typeof pendingChatTerminal>[0] & Parameters<typeof clearChatTerminal>[0]
): Promise<boolean> {
  const terminal = await pendingChatTerminal(storage);
  if (!terminal?.body.includes(LEGACY_SCREENSHOT_REPLAY_ERROR)) return false;
  await clearChatTerminal(storage);
  return true;
}
