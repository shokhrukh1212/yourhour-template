"use client";

import { useClicks } from "@/components/ClicksProvider";

export function ProofClickCount({
  campaignId,
  accountingStatus,
  purchasedClicks,
  initialGuaranteed,
  initialBonus,
  initialTotal,
}: {
  campaignId: string;
  accountingStatus: "verified" | "manual_reconciled" | "legacy_total_only";
  purchasedClicks: number | null;
  initialGuaranteed: number | null;
  initialBonus: number;
  initialTotal: number;
}) {
  const { clicks, bonusClicks } = useClicks();
  const total = clicks[campaignId] ?? initialTotal;
  const bonus = bonusClicks[campaignId] ?? initialBonus;
  const guaranteed = initialGuaranteed === null ? null : Math.max(initialGuaranteed, total - bonus);
  if (accountingStatus === "legacy_total_only" || purchasedClicks === null || guaranteed === null) {
    return <strong className="inline-flex items-baseline leading-none tracking-[-.04em] tabular" aria-label={`${total.toLocaleString()} total clicks received`}><span className="text-[30px] font-semibold">{total.toLocaleString()}</span><span className="ml-1.5 text-sm font-normal text-muted">total clicks received</span></strong>;
  }
  return <span className="text-xs leading-relaxed text-muted tabular" aria-label={`Purchased ${purchasedClicks}, delivered ${guaranteed} of ${purchasedClicks}, bonus ${bonus}, total ${total}`}>
    Purchased: <b className="text-foreground">{purchasedClicks}</b> · Delivered: <b className="text-foreground">{guaranteed}/{purchasedClicks}</b><br />Bonus: <b className="text-violet">{bonus}</b> · Total: <b className="text-accent">{total}</b>
  </span>;
}
