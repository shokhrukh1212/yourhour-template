"use client";

import { useEffect, useState } from "react";

export function VisitorCount({ initialCount, statsUrl }: { initialCount: number; statsUrl?: string }) {
  const [visitors, setVisitors] = useState(initialCount);

  useEffect(() => {
    let active = true;

    fetch("/api/visitors", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { visitors?: number };
        if (active && typeof data.visitors === "number") setVisitors(data.visitors);
      })
      .catch(() => {
        // Analytics must never disrupt the page.
      });

    return () => {
      active = false;
    };
  }, []);

  if (visitors === 0) return null;

  return (
    <span className="hidden items-center gap-1.5 sm:flex">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-live" />
      <span className="tabular">{visitors.toLocaleString()}</span> visitors
      {statsUrl ? (
        <a href={statsUrl} target="_blank" rel="noopener" className="ml-1 hover:text-accent">
          see stats →
        </a>
      ) : null}
    </span>
  );
}
