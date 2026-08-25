export const CLICK_RATE_CENTS = 20;
export const MIN_ENTRY_CENTS = 500;
export const MIN_CLICKS = Math.ceil(MIN_ENTRY_CENTS / CLICK_RATE_CENTS);
export const MAX_CLICKS = 250;
export const CLICK_PACKAGES = [50, 100, 200, 250] as const;
export const DEFAULT_CLICKS = CLICK_PACKAGES[0];
export const DEFAULT_CHECKOUT_CLICKS = CLICK_PACKAGES[1];
export const DEFAULT_PRICE_CENTS = DEFAULT_CLICKS * CLICK_RATE_CENTS;
// A whole-dollar price adjustment is five clicks at the fixed 20¢ rate.
export const CLICK_STEP = 5;

export const QUEUE_JUMP_STEP_CENTS = 100;
export const MIN_JUMP_CENTS = 200;

export function priceForClicks(clicks: number): number {
  return clicks * CLICK_RATE_CENTS;
}

export function clickPackageForInput(raw: string): (typeof CLICK_PACKAGES)[number] | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return CLICK_PACKAGES.find((option) => option === value) ?? null;
}

export function jumpPrice(highestQueuedPriority: number | null): number {
  return Math.max(MIN_JUMP_CENTS, (highestQueuedPriority ?? 0) + QUEUE_JUMP_STEP_CENTS);
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatClickRate(cents = CLICK_RATE_CENTS): string {
  return cents < 100 ? `${cents}¢` : formatPrice(cents);
}
