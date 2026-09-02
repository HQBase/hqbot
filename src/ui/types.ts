import type { BotTeammate, WorkspaceSnapshot } from "../domain/types";

export type RealtimeStatus = "connected" | "connecting" | "unavailable";

export type TeammateSummary = BotTeammate & {
  unreadCount?: number;
};

export type RealtimeDescriptor = {
  url: string;
};

export type WorkspaceView = WorkspaceSnapshot & {
  realtime?: RealtimeDescriptor;
};

export type WorkspaceEvent = { type: "invalidate" } | { snapshot: WorkspaceView; type: "snapshot" };

export type DialogName = "connection" | "routine" | "skill" | null;
