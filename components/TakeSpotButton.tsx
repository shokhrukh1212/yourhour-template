"use client";

import { useBid } from "@/components/BidProvider";
import { useOvertake } from "./OvertakeProvider";
/** Inline CTA (mobile hero card) that jumps to the claim form instead of navigating. */
export function TakeSpotButton({ className }: { className?: string }) {
  const { chooseTopBid, topMinimumBidCents } = useBid();
  const takeover = useOvertake();
  const complete = takeover.kind === "waiting" || takeover.kind === "takeover";
  return (
    <button type="button" className={`${className ?? ""}${complete ? " takeover-complete" : ""}`} aria-controls="product-url" disabled={complete} onClick={chooseTopBid}>
      {complete ? "✓ You’re #1" : `Take #1 for $${topMinimumBidCents / 100}`}
    </button>
  );
}
