import "server-only";

import {
  SPONSOR_DURATIONS,
  SPONSOR_POSITIONS,
  type SponsorDuration,
  type SponsorPosition,
} from "./sponsorship-shared";

export type SponsorPricing = {
  currency: string;
  prices: Record<SponsorPosition, Record<SponsorDuration, number>>;
};

function priceVariable(position: SponsorPosition, duration: SponsorDuration): string {
  return `SPONSOR_SLOT_${position}_PRICE_${duration}D_CENTS`;
}

function readPositiveInteger(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function readSponsorPricing():
  | { ok: true; value: SponsorPricing }
  | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const currency = process.env.SPONSOR_CURRENCY?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(currency)) missing.push("SPONSOR_CURRENCY");

  const prices = {} as SponsorPricing["prices"];
  for (const position of SPONSOR_POSITIONS) {
    prices[position] = {} as Record<SponsorDuration, number>;
    for (const duration of SPONSOR_DURATIONS) {
      const name = priceVariable(position, duration);
      const value = readPositiveInteger(name);
      if (value === null) missing.push(name);
      else prices[position][duration] = value;
    }
  }

  if (!missing.length) {
    for (const duration of SPONSOR_DURATIONS) {
      const ordered = SPONSOR_POSITIONS.every((position, index) => {
        const next = SPONSOR_POSITIONS[index + 1];
        return next === undefined || prices[position][duration] > prices[next][duration];
      });
      if (!ordered) missing.push(`SPONSOR_SLOT_PRICE_ORDER_${duration}D`);
    }
  }

  return missing.length
    ? { ok: false, missing }
    : { ok: true, value: { currency, prices } };
}

export function sponsorPrice(
  position: SponsorPosition,
  duration: SponsorDuration,
): { amountCents: number; currency: string } {
  const pricing = readSponsorPricing();
  if (!pricing.ok) throw new Error("SPONSOR_PRICING_NOT_CONFIGURED");
  return {
    amountCents: pricing.value.prices[position][duration],
    currency: pricing.value.currency,
  };
}
