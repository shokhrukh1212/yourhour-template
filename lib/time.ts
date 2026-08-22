export const HOUR_MS = 60 * 60 * 1000;

/** Floor a date to the exact top of its UTC hour. Every slot starts on one of these. */
export function floorToHour(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}

export function addHours(d: Date, n: number): Date {
  return new Date(d.getTime() + n * HOUR_MS);
}

/** The top of the hour currently in progress. */
export function currentHourStart(now: Date = new Date()): Date {
  return floorToHour(now);
}

/** The first hour that is still purchasable. The in-progress hour is locked forever. */
export function nextPurchasableHour(now: Date = new Date()): Date {
  return addHours(floorToHour(now), 1);
}

/**
 * How long into a live hour it can still be sold. Past this point the hour is given
 * away as a free encore instead, because a buyer paying full price for the last
 * fifteen minutes of an hour would be getting robbed.
 */
export const LIVE_CLAIM_WINDOW_MS = 15 * 60 * 1000;

/** The in-progress hour is buyable only while it is this fresh. */
export function liveHourIsClaimable(startsAt: Date, now: Date = new Date()): boolean {
  const elapsed = now.getTime() - startsAt.getTime();
  return elapsed >= 0 && elapsed < LIVE_CLAIM_WINDOW_MS;
}
