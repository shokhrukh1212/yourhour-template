"use client";

import { useEffect, useState } from "react";

const POLL_MS = 5_000;

export function CampaignClickProgress({
  campaignId,
  accountingStatus,
  purchasedClicks,
  initialGuaranteed,
  initialTotal,
  initialBonusClicks,
}: {
  campaignId: string;
  accountingStatus: "verified" | "manual_reconciled" | "legacy_total_only";
  purchasedClicks: number | null;
  initialGuaranteed: number | null;
  initialTotal: number;
  initialBonusClicks: number;
}) {
  const [delivered, setDelivered] = useState(initialTotal);
  const [bonus, setBonus] = useState(initialBonusClicks);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetch(`/api/wall/clicks?ids=${encodeURIComponent(campaignId)}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json()) as { clicks?: Record<string, number>; bonusClicks?: Record<string, number> };
          const next = data.clicks?.[campaignId];
          if (active && typeof next === "number") setDelivered(next);
          const nextBonus = data.bonusClicks?.[campaignId];
          if (active && typeof nextBonus === "number") setBonus(nextBonus);
        })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(() => document.visibilityState === "visible" && refresh(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [campaignId]);

  const guaranteed = initialGuaranteed === null ? null : Math.max(initialGuaranteed, delivered - bonus);
  if (accountingStatus === "legacy_total_only" || purchasedClicks === null || guaranteed === null) {
    return <div className="flex items-baseline justify-between gap-4"><span className="text-sm text-muted">Total clicks received</span><strong className="text-2xl tabular">{delivered.toLocaleString()}</strong></div>;
  }
  const progress = Math.min(100, (guaranteed / Math.max(1, purchasedClicks)) * 100);
  return <>
    <div className="flex flex-wrap items-baseline justify-between gap-4"><span className="text-sm text-muted">Delivery</span><strong className="text-sm font-normal leading-relaxed text-muted tabular">Purchased: <b className="text-foreground">{purchasedClicks}</b> · Delivered: <b className="text-foreground">{guaranteed}/{purchasedClicks}</b> · Bonus: <b className="text-violet">{bonus}</b> · Total: <b className="text-accent">{delivered}</b></strong></div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.08]" aria-label={`${Math.round(progress)}% delivered`}><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} /></div>
  </>;
}
