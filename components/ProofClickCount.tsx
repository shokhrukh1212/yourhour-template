"use client";

import { useClicks } from "@/components/ClicksProvider";

export function ProofClickCount({
  campaignId,
  initialDelivered,
  paidClicks,
}: {
  campaignId: string;
  initialDelivered: number;
  paidClicks: number;
}) {
  const { clicks } = useClicks();
  const delivered = clicks[campaignId] ?? initialDelivered;
  return <strong className="inline-flex items-baseline leading-none tracking-[-.04em] tabular" aria-label={`${delivered.toLocaleString()} clicks delivered out of ${paidClicks.toLocaleString()} paid`}>
    <span className="text-[30px] font-semibold">{delivered.toLocaleString()}</span>
    <span className="text-base font-normal text-faint">/{paidClicks.toLocaleString()}</span>
    <span className="ml-1.5 text-base font-normal text-muted">clicks</span>
  </strong>;
}
