"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const POLL_MS = 5_000;

// An outbound click is recorded by /r/[id] before the visitor is redirected, so the
// new count is usually readable within a few hundred milliseconds. Re-poll on that
// scale instead of waiting for the next tick, and keep a couple of later retries in
// case the redirect was slow.
const AFTER_CLICK_MS = [300, 900, 2_000, 4_000];

export type ClickSnapshot = {
  deliveredTotal: number;
  deliveredLast24h: number;
  live: { id: string; clicksDelivered: number; bonusClicks: number; bonus: boolean } | null;
  waiting: number;
  clicks: Record<string, number>;
  bonusClicks: Record<string, number>;
};

type ClicksContextValue = ClickSnapshot & { refresh: () => void; notifyClick: () => void };
const ClicksContext = createContext<ClicksContextValue | null>(null);

export function ClicksProvider({
  initial,
  campaignIds,
  children,
}: {
  initial: ClickSnapshot;
  campaignIds: string[];
  children: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const ids = campaignIds.join(",");

  const refresh = useCallback(() => {
    const suffix = ids ? `?ids=${encodeURIComponent(ids)}` : "";
    void fetch(`/api/board${suffix}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const next = (await response.json()) as Partial<ClickSnapshot>;
        setSnapshot((current) => ({
          deliveredTotal: typeof next.deliveredTotal === "number" ? next.deliveredTotal : current.deliveredTotal,
          deliveredLast24h: typeof next.deliveredLast24h === "number" ? next.deliveredLast24h : current.deliveredLast24h,
          live: next.live === undefined ? current.live : next.live,
          waiting: typeof next.waiting === "number" ? next.waiting : current.waiting,
          clicks: next.clicks ? { ...current.clicks, ...next.clicks } : current.clicks,
          bonusClicks: next.bonusClicks ? { ...current.bonusClicks, ...next.bonusClicks } : current.bonusClicks,
        }));
      })
      .catch(() => {});
  }, [ids]);

  // An outbound link opens in a new tab, so every counter on the page can be brought
  // up to date from one place the moment a visitor clicks one.
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notifyClick = useCallback(() => {
    AFTER_CLICK_MS.forEach((delay) => timeouts.current.push(setTimeout(refresh, delay)));
  }, [refresh]);

  useEffect(() => {
    const pending = timeouts.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    // Returning from the tab the outbound link opened should snap the counts up to date.
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...snapshot, refresh, notifyClick }), [snapshot, refresh, notifyClick]);
  return <ClicksContext.Provider value={value}>{children}</ClicksContext.Provider>;
}

export function useClicks(): ClicksContextValue {
  const value = useContext(ClicksContext);
  if (!value) throw new Error("useClicks must be used inside ClicksProvider");
  return value;
}
