import type { ThinkIntervalSchedule } from "@cloudflare/think";

export function intervalSchedule(value: number): ThinkIntervalSchedule {
  const minutes = Math.max(1, Math.round(value));
  return `every ${minutes} minutes`;
}
