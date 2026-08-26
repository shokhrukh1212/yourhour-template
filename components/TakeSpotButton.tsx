"use client";

import { useBid } from "@/components/BidProvider";
/** Inline CTA (mobile hero card) that jumps to the claim form instead of navigating. */
export function TakeSpotButton({ className }: { className?: string }) {
  const { chooseTopBid, topMinimumBidCents } = useBid();
  return (
    <button type="button" className={className} aria-controls="product-url" onClick={chooseTopBid}>
      Take #1 for ${topMinimumBidCents / 100}
    </button>
  );
}
