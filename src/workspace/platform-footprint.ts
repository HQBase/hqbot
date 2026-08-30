import type { CloudflareResourceFootprint } from "../domain/types";
import { number, type Row, type Sql } from "./sql";

function footprint(row: Row | undefined, includeWorkspace: boolean): CloudflareResourceFootprint {
  const teammates = number(row ?? {}, "teammates");
  return {
    durableObjects: teammates + (includeWorkspace ? 1 : 0),
    agentSchedules: teammates + number(row ?? {}, "active_routines"),
    taskSubmissionsToday: number(row ?? {}, "task_submissions"),
    r2FileObjects: number(row ?? {}, "r2_file_objects"),
    r2FileBytes: number(row ?? {}, "r2_file_bytes")
  };
}

export function readCloudflareResourceFootprint(
  sql: Sql,
  botId: string | null | undefined,
  dayStartedAt: string
): { overall: CloudflareResourceFootprint; selectedBot: CloudflareResourceFootprint } {
  const overall = sql<Row>`SELECT
    (SELECT COUNT(*) FROM bots) AS teammates,
    (SELECT COUNT(*) FROM routines WHERE active = 1) AS active_routines,
    (SELECT COUNT(*) FROM tasks WHERE created_at >= ${dayStartedAt}) AS task_submissions,
    (SELECT COUNT(*) FROM files) AS r2_file_objects,
    (SELECT COALESCE(SUM(size), 0) FROM files) AS r2_file_bytes`[0];
  const selected = botId
    ? sql<Row>`SELECT
        (SELECT COUNT(*) FROM bots WHERE id = ${botId}) AS teammates,
        (SELECT COUNT(*) FROM routines WHERE bot_id = ${botId} AND active = 1)
          AS active_routines,
        (SELECT COUNT(*) FROM tasks WHERE bot_id = ${botId} AND created_at >= ${dayStartedAt})
          AS task_submissions,
        (SELECT COUNT(*) FROM files WHERE bot_id = ${botId}) AS r2_file_objects,
        (SELECT COALESCE(SUM(size), 0) FROM files WHERE bot_id = ${botId}) AS r2_file_bytes`[0]
    : undefined;
  return {
    overall: footprint(overall, true),
    selectedBot: footprint(selected, false)
  };
}
