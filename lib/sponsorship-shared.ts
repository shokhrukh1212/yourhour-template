export const SPONSOR_POSITIONS = [1, 2, 3, 4] as const;
export const SPONSOR_DURATIONS = [7, 30] as const;

export type SponsorPosition = (typeof SPONSOR_POSITIONS)[number];
export type SponsorDuration = (typeof SPONSOR_DURATIONS)[number];
export type SponsorPlacement = "sponsor_desktop" | "sponsor_mobile";

/** One source of truth for both the mobile draw and position descriptions. */
export const SPONSOR_POSITION_CONFIG: Record<
  SponsorPosition,
  { weight: number; visibility: string }
> = {
  1: { weight: 40, visibility: "Highest visibility across sponsored placements." },
  2: { weight: 30, visibility: "High visibility across sponsored placements." },
  3: { weight: 20, visibility: "Balanced visibility across sponsored placements." },
  4: { weight: 10, visibility: "Entry-level sponsored visibility." },
};

export type SponsorCampaign = {
  id: string;
  position: SponsorPosition;
  productUrl: string;
  productName: string;
  description: string | null;
  logoUrl: string | null;
  durationDays: SponsorDuration;
  amountPaidCents: number;
  currency: string;
  clickCount: number;
  startsAt: string;
  endsAt: string;
};

export type SponsorSlot = {
  position: SponsorPosition;
  prices: Record<SponsorDuration, number | null>;
  currency: string | null;
  active: SponsorCampaign | null;
  reservedUntil: string | null;
};

export function chooseWeightedSponsor(
  campaigns: SponsorCampaign[],
  randomValue = Math.random(),
): SponsorCampaign | null {
  if (!campaigns.length) return null;
  const weighted = campaigns.map((campaign) => ({
    campaign,
    weight: SPONSOR_POSITION_CONFIG[campaign.position].weight,
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.max(0, Math.min(0.999999999, randomValue)) * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor < 0) return item.campaign;
  }
  return weighted[weighted.length - 1].campaign;
}
