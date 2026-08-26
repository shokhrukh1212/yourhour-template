"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { nextBidCents } from "@/lib/pricing";
import { projectedRankForBid } from "@/lib/rank";
import { focusClaimForm } from "@/lib/scroll-to-claim";

const BOARD_POLL_MS = 5_000;

type BidContextValue = {
  bidCents: number;
  /** Lowest amount the stepper may reach for the currently selected placement. */
  minBidCents: number;
  /** Latest server-provided amount required to take the homepage. */
  topMinimumBidCents: number;
  rank: number;
  setBidCents: React.Dispatch<React.SetStateAction<number>>;
  chooseBid: (amountCents: number) => void;
  chooseTopBid: () => void;
};

const BidContext = createContext<BidContextValue | null>(null);

export function BidProvider({
  initialBidCents,
  initialMinimumBidCents,
  initialTopId,
  existingBids,
  children,
}: {
  initialBidCents: number;
  initialMinimumBidCents: number;
  initialTopId: string | null;
  existingBids: number[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [storedBidCents, setBidCents] = useState(initialBidCents);
  const [selectedMinBidCents, setSelectedMinBidCents] = useState(initialBidCents);
  const [polledTopMinimumBidCents, setPolledTopMinimumBidCents] = useState(initialMinimumBidCents);
  const [followsTop, setFollowsTop] = useState(initialBidCents === initialMinimumBidCents);
  const latestTopRef = useRef({ id: initialTopId, minimumBidCents: initialMinimumBidCents });
  const topMinimumBidCents = Math.max(initialMinimumBidCents, polledTopMinimumBidCents);
  const minBidCents = followsTop ? topMinimumBidCents : selectedMinBidCents;
  const bidCents = Math.max(storedBidCents, minBidCents);
  const rank = projectedRankForBid(existingBids, bidCents);

  useEffect(() => {
    if (initialMinimumBidCents >= latestTopRef.current.minimumBidCents) {
      latestTopRef.current = { id: initialTopId, minimumBidCents: initialMinimumBidCents };
    }
  }, [initialMinimumBidCents, initialTopId]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 768px)");
    let active = true;
    let inFlight = false;
    let timer: number | null = null;
    let controller: AbortController | null = null;

    const refresh = async () => {
      if (!active || inFlight || !mobile.matches || document.visibilityState !== "visible") return;
      inFlight = true;
      controller = new AbortController();
      try {
        const response = await fetch("/api/leaderboard?offset=0&limit=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const json = await response.json() as {
          items?: Array<{ id: string; bid_cents: number }>;
        };
        const top = json.items?.[0] ?? null;
        const minimumBidCents = nextBidCents(top?.bid_cents ?? null);
        if (top?.id === latestTopRef.current.id
          && minimumBidCents === latestTopRef.current.minimumBidCents) return;

        latestTopRef.current = { id: top?.id ?? null, minimumBidCents };
        setPolledTopMinimumBidCents((current) => Math.max(current, minimumBidCents));
        // The lightweight poll only detects a changed board. Refreshing the RSC tree
        // then updates the featured product, visible rows and complete rank inputs.
        router.refresh();
      } catch {
        // Keep the last server-confirmed floor; the next visible poll retries.
      } finally {
        inFlight = false;
      }
    };

    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      controller?.abort();
    };
    const start = () => {
      stop();
      if (!mobile.matches) return;
      timer = window.setInterval(refresh, BOARD_POLL_MS);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleBreakpoint = () => {
      start();
      if (mobile.matches) void refresh();
    };

    start();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    mobile.addEventListener("change", handleBreakpoint);
    return () => {
      active = false;
      stop();
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      mobile.removeEventListener("change", handleBreakpoint);
    };
  }, [router]);

  const value = useMemo<BidContextValue>(() => ({
    bidCents,
    minBidCents,
    topMinimumBidCents,
    rank,
    setBidCents,
    chooseBid(amountCents) {
      setBidCents(amountCents);
      setSelectedMinBidCents(amountCents);
      const nextFollowsTop = amountCents === topMinimumBidCents;
      setFollowsTop(nextFollowsTop);
      focusClaimForm();
    },
    chooseTopBid() {
      setFollowsTop(true);
      setSelectedMinBidCents(topMinimumBidCents);
      setBidCents(topMinimumBidCents);
      focusClaimForm();
    },
  }), [bidCents, minBidCents, rank, topMinimumBidCents]);

  return <BidContext.Provider value={value}>{children}</BidContext.Provider>;
}

export function useBid(): BidContextValue {
  const value = useContext(BidContext);
  if (!value) throw new Error("useBid must be used inside BidProvider");
  return value;
}
