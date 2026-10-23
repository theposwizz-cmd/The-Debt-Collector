import { getDb } from "./db.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Simulated clock. Real time plus a persisted offset, so the demo can
 * "fast-forward" days in seconds and the nudge escalation becomes visible.
 */
export function getOffsetMs(): number {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key = 'clock_offset_ms'").get() as
    | { value: string }
    | undefined;
  return row ? Number(row.value) : 0;
}

export function now(): number {
  return Date.now() + getOffsetMs();
}

export function advance(days: number): number {
  const next = getOffsetMs() + Math.round(days * DAY_MS);
  getDb()
    .prepare(
      "INSERT INTO app_state (key, value) VALUES ('clock_offset_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(String(next));
  return next;
}

export function resetClock(): void {
  getDb().prepare("DELETE FROM app_state WHERE key = 'clock_offset_ms'").run();
}
