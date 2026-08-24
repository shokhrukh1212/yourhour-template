"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const POLL_MS = 5_000;

export type ClickSnapshot = {
  deliveredTotal: number;
  deliveredToday: number;
  live: { id: string; clicksDelivered: number; bonusClicks: number; bonus: boolean } | null;
  waiting: number;
  clicks: Record<string, number>;
  bonusClicks: Record<string, number>;
};

type ClicksContextValue = ClickSnapshot & { refresh: () => void };
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
          deliveredToday: typeof next.deliveredToday === "number" ? next.deliveredToday : current.deliveredToday,
          live: next.live === undefined ? current.live : next.live,
          waiting: typeof next.waiting === "number" ? next.waiting : current.waiting,
          clicks: next.clicks ? { ...current.clicks, ...next.clicks } : current.clicks,
          bonusClicks: next.bonusClicks ? { ...current.bonusClicks, ...next.bonusClicks } : current.bonusClicks,
        }));
      })
      .catch(() => {});
  }, [ids]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...snapshot, refresh }), [snapshot, refresh]);
  return <ClicksContext.Provider value={value}>{children}</ClicksContext.Provider>;
}

export function useClicks(): ClicksContextValue {
  const value = useContext(ClicksContext);
  if (!value) throw new Error("useClicks must be used inside ClicksProvider");
  return value;
}
