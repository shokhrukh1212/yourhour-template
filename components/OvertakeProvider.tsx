"use client";

import { useRouter } from "next/navigation";
import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  consumeVerifiedTakeover,
  hasReplayedTakeover,
  verifiedTakeoverFromStatus,
  type CheckoutTakeoverStatus,
} from "@/lib/takeover-motion";

type MotionKind = "idle" | "waiting" | "takeover" | "external";

type MotionState = {
  kind: MotionKind;
  listingId: string | null;
  animate: boolean;
};

type OvertakeContextValue = MotionState & {
  hasPurchaseIntent: boolean;
  beginVerifiedTakeover: (result: CheckoutTakeoverStatus) => "pending" | "replayed" | "ineligible";
};

const OvertakeContext = createContext<OvertakeContextValue | null>(null);
const FEATURED_INTRO_KEY = "yourhour:featured-intro:v1";

function motionIsAllowed(): boolean {
  return document.visibilityState === "visible"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rememberFeaturedIntro(): void {
  try {
    window.sessionStorage.setItem(FEATURED_INTRO_KEY, "1");
  } catch {
    // The intro component also keeps an in-document fallback when storage is blocked.
  }
}

export function OvertakeProvider({
  topId,
  topName,
  hasPurchaseIntent,
  children,
}: {
  topId: string | null;
  topName: string | null;
  hasPurchaseIntent: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [motion, setMotion] = useState<MotionState>({ kind: "idle", listingId: null, animate: false });
  const [pendingResult, setPendingResult] = useState<CheckoutTakeoverStatus | null>(null);
  const [externalMessage, setExternalMessage] = useState<string | null>(null);
  const previousTopRef = useRef(topId);
  const topIdRef = useRef(topId);
  const refreshResolvedRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    topIdRef.current = topId;
  }, [topId]);

  const beginVerifiedTakeover = useCallback((result: CheckoutTakeoverStatus) => {
    const replaceWithVerifiedBoard = () => {
      const cleanRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      startTransition(() => router.replace(cleanRoute, { scroll: false }));
    };
    const candidate = verifiedTakeoverFromStatus(result);
    if (!candidate) {
      if (result.ready && result.status === "completed") replaceWithVerifiedBoard();
      return "ineligible" as const;
    }

    if (hasReplayedTakeover(candidate.transactionId)) {
      replaceWithVerifiedBoard();
      return "replayed" as const;
    }

    clearTimers();
    setPendingResult(result);
    setMotion({ kind: "waiting", listingId: candidate.listingId, animate: motionIsAllowed() });

    const canEnhanceHandoff = topIdRef.current !== candidate.listingId
      && motionIsAllowed()
      && window.matchMedia("(min-width: 769px)").matches
      && typeof document.startViewTransition === "function";

    if (canEnhanceHandoff) {
      let resolveRefresh = () => {};
      const boardReady = new Promise<void>((resolve) => { resolveRefresh = resolve; });
      refreshResolvedRef.current = resolveRefresh;
      const transition = document.startViewTransition(async () => {
        replaceWithVerifiedBoard();
        await boardReady;
      });
      void transition.finished.catch(() => {});
    } else {
      replaceWithVerifiedBoard();
    }
    return "pending" as const;
  }, [clearTimers, router]);

  useEffect(() => {
    if (!pendingResult) return;
    const candidate = verifiedTakeoverFromStatus(pendingResult);
    if (!candidate || candidate.listingId !== topId) return;

    refreshResolvedRef.current?.();
    refreshResolvedRef.current = null;
    const takeover = consumeVerifiedTakeover(pendingResult, topId);
    timersRef.current.push(window.setTimeout(() => {
      setPendingResult(null);
      if (!takeover) {
        setMotion({ kind: "idle", listingId: null, animate: false });
        return;
      }

      rememberFeaturedIntro();
      const animate = motionIsAllowed();
      setMotion({ kind: "takeover", listingId: takeover.listingId, animate });

      if (window.matchMedia("(max-width: 768px)").matches) {
        const card = document.querySelector<HTMLElement>(".featured-card");
        const rect = card?.getBoundingClientRect();
        const visible = rect ? rect.bottom > 0 && rect.top < window.innerHeight : true;
        if (card && !visible) {
          timersRef.current.push(window.setTimeout(() => {
            card.scrollIntoView({ block: "start", behavior: animate ? "smooth" : "auto" });
          }, 60));
        }
      }

      const duration = window.matchMedia("(max-width: 768px)").matches ? 1_100 : 1_650;
      timersRef.current.push(window.setTimeout(() => {
        setMotion({ kind: "idle", listingId: null, animate: false });
      }, animate ? duration : 150));
    }, 0));
  }, [pendingResult, topId]);

  useEffect(() => {
    const previousTop = previousTopRef.current;
    previousTopRef.current = topId;
    if (previousTop === topId || !topId) return;
    const pending = verifiedTakeoverFromStatus(pendingResult);
    if (pending?.listingId === topId) return;
    if (motion.kind === "takeover" && motion.listingId === topId) return;

    clearTimers();
    const animate = motionIsAllowed();
    timersRef.current.push(window.setTimeout(() => {
      setMotion({ kind: "external", listingId: topId, animate });
      setExternalMessage(`New #1: ${topName || "A new product"}`);
      timersRef.current.push(window.setTimeout(() => {
        setMotion({ kind: "idle", listingId: null, animate: false });
      }, animate ? 550 : 150));
      timersRef.current.push(window.setTimeout(() => setExternalMessage(null), 3_500));
    }, 0));
  }, [clearTimers, motion.kind, motion.listingId, pendingResult, topId, topName]);

  useEffect(() => {
    if (!pendingResult) return;
    const timer = window.setTimeout(() => {
      refreshResolvedRef.current?.();
      refreshResolvedRef.current = null;
      setPendingResult(null);
      setMotion({ kind: "idle", listingId: null, animate: false });
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [pendingResult]);

  useEffect(() => () => {
    clearTimers();
    refreshResolvedRef.current?.();
    refreshResolvedRef.current = null;
  }, [clearTimers]);

  const value = useMemo<OvertakeContextValue>(() => ({
    ...motion,
    hasPurchaseIntent,
    beginVerifiedTakeover,
  }), [beginVerifiedTakeover, hasPurchaseIntent, motion]);

  return (
    <OvertakeContext.Provider value={value}>
      {children}
      {externalMessage ? (
        <div className="leader-change-notice" role="status" aria-live="polite">
          {externalMessage}
        </div>
      ) : null}
    </OvertakeContext.Provider>
  );
}

export function useOvertake(): OvertakeContextValue {
  const value = useContext(OvertakeContext);
  if (!value) throw new Error("useOvertake must be used inside OvertakeProvider");
  return value;
}

export function OvertakeTrail() {
  const motion = useOvertake();
  return (
    <span
      className={`overtake-trail${motion.kind === "takeover" && motion.animate ? " is-active" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span />
      <span />
    </span>
  );
}

export { FEATURED_INTRO_KEY };
