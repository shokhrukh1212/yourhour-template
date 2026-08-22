"use client";

import { useEffect } from "react";
import { useNow } from "@/lib/use-client-time";

function format(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * "27:41 left". Spec section 1: a countdown converts where a static list never does.
 * Reloads the page when the hour rolls over so the next product takes the screen --
 * exactly one countdown on the page should own that, or two of them race the reload.
 */
export function Countdown({
  endsAtIso,
  suffix = "left",
  reloadOnZero = true,
}: {
  endsAtIso: string;
  suffix?: string;
  reloadOnZero?: boolean;
}) {
  const endsAt = new Date(endsAtIso).getTime();
  const now = useNow();
  const hydrated = now !== 0;
  const remaining = endsAt - now;

  useEffect(() => {
    if (!reloadOnZero || !hydrated || remaining > 0) return;
    window.location.reload();
  }, [reloadOnZero, hydrated, remaining]);

  return (
    <span className="tabular" suppressHydrationWarning>
      {hydrated ? `${format(remaining)}${suffix ? ` ${suffix}` : ""}` : " "}
    </span>
  );
}
