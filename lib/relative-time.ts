const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

/**
 * How long ago a payment landed, in whole units that only ever round down:
 * 119 minutes is still "1 hour ago", 47 hours is still "1 day ago".
 */
export function formatRelativeTime(elapsedMs: number): string {
  if (elapsedMs < MINUTE) return "just now";
  if (elapsedMs < HOUR) return plural(Math.floor(elapsedMs / MINUTE), "minute");
  if (elapsedMs < DAY) return plural(Math.floor(elapsedMs / HOUR), "hour");
  return plural(Math.floor(elapsedMs / DAY), "day");
}

/**
 * Milliseconds until the label is worth re-rendering: every five minutes while the
 * label is in minutes, then on each hour and each day boundary. The minute branch
 * is clamped so the jump to "1 hour ago" is never five minutes late.
 */
export function relativeTimeRefreshMs(elapsedMs: number): number {
  if (elapsedMs < 0) return MINUTE;
  if (elapsedMs < MINUTE) return MINUTE - elapsedMs;
  if (elapsedMs < HOUR) return Math.min(FIVE_MINUTES, HOUR - elapsedMs);
  if (elapsedMs < DAY) return HOUR - (elapsedMs % HOUR);
  return DAY - (elapsedMs % DAY);
}
