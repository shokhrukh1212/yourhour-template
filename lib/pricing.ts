/**
 * What a spot on The Wall costs.
 *
 * There is no stored price. Nothing decays, nothing is scaled by time of day, and
 * nothing ever gets cheaper because a buyer waited. The only number the site quotes is
 * derived from the Wall itself. Every quoted price is a whole dollar, so an entry can
 * always be overtaken with a number a buyer can read at a glance.
 */

/** The least anyone may pay to get on the Wall at all, in cents. */
export const MIN_ENTRY_CENTS = 300;

/** The nudge buttons move in whole dollars. */
export const OUTBID_STEP_CENTS = 100;

/** What #1 costs while the Wall is still empty. */
export const EMPTY_WALL_TOP_CENTS = 500;

/**
 * The price of rank #1.
 *
 * `topAmount` is the highest `wall_entries.amount_paid`, or null on an empty Wall.
 * Stored amounts remain cents, but the price is calculated in dollars and rounded up:
 * ceil(top + $1).
 */
export function numberOnePrice(topAmount: number | null): number {
  return topAmount === null || topAmount <= 0 ? EMPTY_WALL_TOP_CENTS : priceToOvertake(topAmount);
}

/** The whole-dollar price needed to move directly ahead of an entry at `amountCents`. */
export function priceToOvertake(amountCents: number): number {
  return Math.max(MIN_ENTRY_CENTS, roundUpToWholeDollar(amountCents + OUTBID_STEP_CENTS));
}

/** Every public dollar amount is rounded up, while the stored cents stay untouched. */
export function roundUpToWholeDollar(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}

/** Public money never exposes cents. */
export function formatPrice(cents: number): string {
  return `$${(roundUpToWholeDollar(cents) / 100).toLocaleString("en-US")}`;
}
