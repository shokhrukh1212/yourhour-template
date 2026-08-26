"use client";

import { useBid } from "@/components/BidProvider";
import { focusClaimForm } from "@/lib/scroll-to-claim";

/** Inline CTA (mobile hero card) that jumps to the claim form instead of navigating. */
export function TakeSpotButton({ className }: { className?: string }) {
  const { bidCents, rank } = useBid();
  return (
    <button type="button" className={className} onClick={focusClaimForm}>
      Take #{rank} for ${bidCents / 100}
    </button>
  );
}
