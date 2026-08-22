"use client";

import { useEffect, useState } from "react";
import { formatPrice } from "@/lib/pricing";

/**
 * The two numbers on a buyer's permanent page that keep moving: their click count, and
 * what rank #1 costs now. A buyer refreshing during their own hour watches the counter
 * climb, and the price gap is the reason the page is worth posting later -- it only ever
 * grows, so an early entry looks better the longer it sits there.
 */
export function LiveStats({
  slug,
  initialClicks,
  initialNumberOne,
  pricePaid,
  rank,
}: {
  slug: string;
  initialClicks: number;
  initialNumberOne: number;
  pricePaid: number | null;
  /** Position on The Wall. Absent where there is no ranking to show. */
  rank?: number;
}) {
  const [clicks, setClicks] = useState(initialClicks);
  const [numberOne, setNumberOne] = useState(initialNumberOne);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/slot/${slug}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { clicks?: number; numberOne?: number };
        if (typeof json.clicks === "number") setClicks(json.clicks);
        if (typeof json.numberOne === "number") setNumberOne(json.numberOne);
      } catch {
        // A failed poll is not worth surfacing; the next one catches up.
      }
    };
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, [slug]);

  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat label="Clicks" value={clicks.toLocaleString()} />
      {pricePaid ? <Stat label="Paid" value={formatPrice(pricePaid)} /> : null}
      {rank ? <Stat label="Wall rank" value={`#${rank}`} /> : null}
      <Stat label="#1 costs now" value={formatPrice(numberOne)} accent />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-5 py-4">
      <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-faint">
        {label}
      </p>
      <p
        className={`mt-1.5 text-2xl font-semibold tabular ${accent ? "text-accent" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
