/**
 * What a spot on The Wall costs.
 *
 * There is no stored price. Nothing decays, nothing is scaled by time of day, and
 * nothing ever gets cheaper because a buyer waited. The only number the site quotes is
 * derived from the Wall itself: beat the top entry by a dollar and you are #1.
 */

/** The least anyone may pay to get on the Wall at all, in cents. */
export const MIN_ENTRY_CENTS = 300;

/** How far above the current top entry #1 sits. */
export const OUTBID_STEP_CENTS = 100;

/** What #1 costs while the Wall is still empty. */
export const EMPTY_WALL_TOP_CENTS = 500;

/**
 * The price of rank #1.
 *
 * `topAmount` is the highest `wall_entries.amount_paid`, or null on an empty Wall. This
 * only ever rises, and only because somebody actually paid -- there is no path by which
 * it can fall, so no reason for a visitor to wait.
 */
export function numberOnePrice(topAmount: number | null): number {
  return topAmount === null || topAmount <= 0
    ? EMPTY_WALL_TOP_CENTS
    : topAmount + OUTBID_STEP_CENTS;
}

/** A whole number of dollars shows as "$21"; anything else keeps its cents, "$1.25". */
export function formatPrice(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const remainder = cents % 100;
  const dollars = whole.toLocaleString("en-US");
  return remainder === 0 ? `$${dollars}` : `$${dollars}.${String(remainder).padStart(2, "0")}`;
}
