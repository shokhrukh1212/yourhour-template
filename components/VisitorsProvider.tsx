"use client";

import { createContext, useContext, useEffect, useState } from "react";

const POLL_MS = 60_000;
const VisitorsContext = createContext<number | null>(null);

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
        .catch(() => {});

    void read(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read(false);
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void read(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return <VisitorsContext.Provider value={visitors}>{children}</VisitorsContext.Provider>;
}

export function useVisitors(): number {
  const value = useContext(VisitorsContext);
  if (value === null) throw new Error("useVisitors must be used inside VisitorsProvider");
  return value;
}
