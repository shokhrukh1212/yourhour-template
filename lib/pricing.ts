export const STARTING_BID_CENTS = 300;
export const BID_STEP_CENTS = 100;
export const MAX_BID_CENTS = 1_000_000;

export function nextBidCents(currentBidCents: number | null): number {
  return currentBidCents === null ? STARTING_BID_CENTS : Math.max(STARTING_BID_CENTS, currentBidCents + BID_STEP_CENTS);
}

export function normalizeLegacyBidCents(amountPaidCents: number): number {
  return Math.max(BID_STEP_CENTS, Math.ceil(Math.max(0, amountPaidCents) / BID_STEP_CENTS) * BID_STEP_CENTS);
}

export function amountDueCents(currentBidCents: number | null, targetBidCents: number): number {
  return targetBidCents - (currentBidCents ?? 0);
}

/** Every verified dollar remains credited even if another checkout completed first. */
export function settledBidCents(currentBidCents: number, targetBidCents: number, amountChargedCents: number): number {
  return Math.max(targetBidCents, currentBidCents + amountChargedCents);
}

export function isWholeDollarBid(value: number): boolean {
  return Number.isSafeInteger(value) && value >= STARTING_BID_CENTS && value <= MAX_BID_CENTS && value % BID_STEP_CENTS === 0;
}

/** Keeps a controlled dollar input empty while editing and removes leading zeroes. */
export function normalizeDollarInput(value: string): string | null {
  if (value === "") return "";
  if (!/^\d+$/.test(value)) return null;
  return value.replace(/^0+(?=\d)/, "");
}
