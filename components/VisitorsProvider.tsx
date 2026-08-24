"use client";

import { createContext, useContext, useEffect, useState } from "react";

/** How often an open tab re-reads the total. Cheap: `peek` is one COUNT and no writes. */
const POLL_MS = 60_000;

const VisitorsContext = createContext<number | null>(null);

/**
 * The cumulative visitor total used by the hero's since-launch statistic.
 *
 * The first call registers this browser; every call after it only reads, on an interval
 * and whenever the tab comes back to the foreground.
 */
export function VisitorsProvider({
  initial,
  children,
}: {
  initial: number;
  children: React.ReactNode;
}) {
  const [visitors, setVisitors] = useState(initial);

  useEffect(() => {
    let active = true;

    const read = (register: boolean) =>
      fetch(register ? "/api/visitors" : "/api/visitors?peek=1", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json()) as { visitors?: number };
          if (active && typeof data.visitors === "number") setVisitors(data.visitors);
        })
        .catch(() => {
          // Analytics must never disrupt the page. The next tick catches up.
        });

    read(true);

    const timer = setInterval(() => {
      // A backgrounded tab is nobody watching; skip the round trip until it returns.
      if (document.visibilityState === "visible") read(false);
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") read(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <VisitorsContext.Provider value={visitors}>{children}</VisitorsContext.Provider>;
}

/**
 * The cumulative total. `fallback` is what the server rendered, used only outside a provider
 * so a component can still be dropped onto a page that has no live count.
 */
export function useVisitors(fallback = 0): number {
  return useContext(VisitorsContext) ?? fallback;
}
