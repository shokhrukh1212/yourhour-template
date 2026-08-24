export const CLICK_RATE_CENTS = 20;
export const MIN_ENTRY_CENTS = 500;
export const MIN_CLICKS = Math.ceil(MIN_ENTRY_CENTS / CLICK_RATE_CENTS);
export const MAX_CLICKS = 250;
export const CLICK_PACKAGES = [50, 100, 200, 250] as const;
export const DEFAULT_CLICKS = CLICK_PACKAGES[0];
export const CLICK_STEP = 10;

export const QUEUE_JUMP_STEP_CENTS = 100;
export const MIN_JUMP_CENTS = 200;
const LEGACY_DISPLAY_RATE_CENTS = 25;

export function priceForClicks(clicks: number): number {
  return clicks * CLICK_RATE_CENTS;
}

/**
 * The six listings imported from the former time-based product have no purchased-click
 * total. For display only, translate what they paid into whole clicks at today's rate.
 * Their historical delivered count remains untouched, so these rows can honestly show
 * more than 100% delivery (for example, 66 delivered / 18 paid).
 */
export function paidClicksForDisplay(campaign: {
  clicks_purchased: number;
  amount_paid_cents: number;
  status: "queued" | "live" | "delivered";
  started_at: Date | string | null;
  delivered_at: Date | string | null;
}): number {
  const isLegacyTimePurchase =
    campaign.status === "delivered" &&
    campaign.started_at === null &&
    campaign.delivered_at === null;
  return isLegacyTimePurchase
    ? Math.max(1, Math.floor(campaign.amount_paid_cents / LEGACY_DISPLAY_RATE_CENTS))
    : campaign.clicks_purchased;
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
