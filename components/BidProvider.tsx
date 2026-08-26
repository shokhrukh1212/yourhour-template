"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { projectedRankForBid } from "@/lib/rank";
import { focusClaimForm } from "@/lib/scroll-to-claim";

type BidContextValue = {
  bidCents: number;
  rank: number;
  setBidCents: React.Dispatch<React.SetStateAction<number>>;
  chooseBid: (amountCents: number) => void;
};

const BidContext = createContext<BidContextValue | null>(null);

export function BidProvider({
  initialBidCents,
  existingBids,
  children,
}: {
  initialBidCents: number;
  existingBids: number[];
  children: React.ReactNode;
}) {
  const [bidCents, setBidCents] = useState(initialBidCents);
  const rank = projectedRankForBid(existingBids, bidCents);

  const value = useMemo<BidContextValue>(() => ({
    bidCents,
    rank,
    setBidCents,
    chooseBid(amountCents) {
      setBidCents(amountCents);
      focusClaimForm();
    },
  }), [bidCents, rank]);

  return <BidContext.Provider value={value}>{children}</BidContext.Provider>;
}

export function useBid(): BidContextValue {
  const value = useContext(BidContext);
  if (!value) throw new Error("useBid must be used inside BidProvider");
  return value;
}
