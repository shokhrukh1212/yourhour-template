"use client";

import { useEffect, useState } from "react";

const POLL_MS = 5_000;

export function CampaignClickProgress({
  campaignId,
  initialDelivered,
  paidClicks,
  initialBonusClicks,
}: {
  campaignId: string;
  initialDelivered: number;
  paidClicks: number;
  initialBonusClicks: number;
}) {
  const [delivered, setDelivered] = useState(initialDelivered);
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

  const guaranteed = Math.max(0, delivered - bonus);
  const progress = Math.min(100, (guaranteed / Math.max(1, paidClicks)) * 100);
  return <>
    <div className="flex items-baseline justify-between gap-4"><span className="text-sm text-muted">Clicks delivered</span>{bonus > 0 ? <strong className="inline-flex items-baseline gap-1 tabular"><span className="text-2xl">{delivered.toLocaleString()}</span><span className="text-sm font-normal text-faint">clicks ({bonus.toLocaleString()} bonus)</span></strong> : <strong className="inline-flex items-baseline tabular"><span className="text-2xl">{delivered.toLocaleString()}</span><span className="text-sm font-normal text-faint">/{paidClicks.toLocaleString()}</span></strong>}</div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[.08]" aria-label={`${Math.round(progress)}% delivered`}><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} /></div>
  </>;
}
