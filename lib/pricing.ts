import { config } from "./config";
import { peakMultiplier } from "./peak";

export const SALE_MULTIPLIER = 1.2;
export const DECAY_MULTIPLIER = 0.95;

/**
 * Silence is only expensive once it persists. Three quiet hours cost nothing; the
 * fourth shaves 5% -- and then the grace period starts over, so P steps down at most
 * once every four silent hours rather than every hour of a long dead night. A sale
 * resets the count too.
 */
export const SILENT_HOURS_BEFORE_DECAY = 3;

/** P can never fall below half of the highest it has ever been. */
export const RATCHET_FRACTION = 0.5;

/** The cheapest permanent Wall spot, in cents. */
export const WALL_MIN_CENTS = 500;

/**
 * No hour, in any tier, at any time, is ever priced below this. A flat literal rather
 * than config.priceFloor because this number is also computed in the browser, where a
 * server-only env var would silently fall back and let the two sides disagree.
 */
export const GLOBAL_MIN_CENTS = 100;

/**
 * An unsold hour this close to starting is cleared at a flat price.
 *
 * Deliberately shorter than an hour. Slots begin on the hour, so a 60-minute window
 * would put the NEXT hour permanently on clearance and nobody would ever have a reason
 * to pay the real price for it -- they could just wait. At 30 minutes the next hour
 * holds its tier price for the first half of the hour and only then goes cheap.
 */
export const LAST_MINUTE_WINDOW_MS = 30 * 60 * 1000;
export const LAST_MINUTE_CENTS = 100;

/** Consecutive-hour blocks and what they cost, as a multiple of the hour's floor. */
export const BLOCK_OPTIONS = [
  { hours: 1, multiplier: 1 },
  { hours: 3, multiplier: 2.5 },
] as const;

export type BlockHours = (typeof BLOCK_OPTIONS)[number]["hours"];

/** The same hour of the day, for N consecutive days. Priced off that hour's floor. */
export const STANDING_OPTIONS = [
  { days: 3, multiplier: 2.5 },
  { days: 7, multiplier: 5 },
] as const;

export type StandingDays = (typeof STANDING_OPTIONS)[number]["days"];

/** Money is integer cents everywhere. Every price move rounds to the nearest cent. */
export function roundToCent(cents: number): number {
  return Math.round(cents);
}

/**
 * The floor P is actually allowed to reach. The hard floor from config is the opening
 * one; once the board has been higher, half of that high becomes the new floor and
 * stays there forever. A board that climbed to $40 never sells an hour under $20 again.
 */
export function effectiveFloor(allTimeHigh: number): number {
  return Math.max(config.priceFloor, roundToCent(allTimeHigh * RATCHET_FRACTION));
}

function clampToFloor(cents: number, allTimeHigh: number): number {
  return Math.max(effectiveFloor(allTimeHigh), roundToCent(cents));
}

/** Any sale, of any size: P = P x 1.20. Paying above the floor does not move it further. */
export function applySale(price: number, allTimeHigh: number): number {
  return clampToFloor(price * SALE_MULTIPLIER, allTimeHigh);
}

/** The fourth silent hour of a run: P = P x 0.95, and the run restarts from zero. */
export function applyDecay(price: number, allTimeHigh: number): number {
  return clampToFloor(price * DECAY_MULTIPLIER, allTimeHigh);
}

/**
 * What one particular hour is worth, before any block discount or clearance: the stored
 * board floor scaled by that hour's time-of-day tier.
 *
 * Clamped to GLOBAL_MIN_CENTS and NOT to the ratcheted floor -- a dead hour is
 * deliberately allowed to sit below a floor the board has ratcheted up to, because the
 * tier is a statement about the hour, not about the board.
 */
export function hourFloor(baseFloor: number, startsAt: Date): number {
  return Math.max(GLOBAL_MIN_CENTS, roundToCent(baseFloor * peakMultiplier(startsAt)));
}

/**
 * An hour about to start and still unsold. Unbounded below, so the hour already in
 * progress -- sellable for its first fifteen minutes -- clears too.
 */
export function isLastMinute(startsAt: Date, now: Date = new Date()): boolean {
  return startsAt.getTime() - now.getTime() < LAST_MINUTE_WINDOW_MS;
}

/**
 * The price of buying THIS ONE HOUR on its own. Clearance applies here and nowhere
 * else: it exists to fill a single hour that is otherwise about to be wasted, not to
 * discount a block or a standing booking that runs for days afterwards.
 */
export function hourPrice(baseFloor: number, startsAt: Date, now: Date = new Date()): number {
  return isLastMinute(startsAt, now) ? LAST_MINUTE_CENTS : hourFloor(baseFloor, startsAt);
}

export function blockMultiplier(hours: number): number {
  return BLOCK_OPTIONS.find((b) => b.hours === hours)?.multiplier ?? 1;
}

export function standingMultiplier(days: number): number {
  return STANDING_OPTIONS.find((s) => s.days === days)?.multiplier ?? 1;
}

/**
 * The least a buyer may pay for `hours` consecutive hours starting at `startsAt`.
 * Priced off the anchor hour's tier, so a block starting in prime time costs prime
 * rates for the whole run.
 */
export function blockMinimum(baseFloor: number, startsAt: Date, hours: number): number {
  return Math.max(
    GLOBAL_MIN_CENTS,
    roundToCent(hourFloor(baseFloor, startsAt) * blockMultiplier(hours)),
  );
}

/** The least a buyer may pay to hold `startsAt`'s hour on each of `days` days. */
export function standingMinimum(baseFloor: number, startsAt: Date, days: number): number {
  return Math.max(
    GLOBAL_MIN_CENTS,
    roundToCent(hourFloor(baseFloor, startsAt) * standingMultiplier(days)),
  );
}

/**
 * A block is one payment across N hours. Each hour carries its own share so that no
 * per-hour surface ever overstates what was paid, and the shares add back up exactly --
 * the remainder cents go to the earliest hours rather than being rounded away.
 */
export function splitAmount(total: number, parts: number): number[] {
  if (parts <= 1) return [total];
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** A whole number of dollars shows as "$21"; anything else keeps its cents, "$1.25". */
export function formatPrice(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const remainder = cents % 100;
  const dollars = whole.toLocaleString("en-US");
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, "0")}`;
}
