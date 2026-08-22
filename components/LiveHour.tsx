"use client";

import { useEffect, useState } from "react";
import { vemetric } from "@vemetric/react";
import { Countdown } from "@/components/Countdown";
import { LocalTime } from "@/components/LocalTime";

export type LiveHourData = {
  slotId: string | null;
  startsAtIso: string;
  endsAtIso: string;
  displayName: string | null;
  url: string | null;
  pitch: string | null;
  /** Clicks this hour has earned while it has been on screen. */
  clicks: number;
};

const CTA =
  "inline-flex items-center gap-2 rounded-full bg-accent px-8 py-4 text-lg font-medium text-white transition hover:scale-[1.03] hover:opacity-95";

/**
 * The hour on screen right now. Two states and no third: it is either sold, or it is
 * empty and the next open hour is for sale.
 *
 * An empty hour is never filled with somebody else's product for free. A visitor who
 * lands on a page showing a product that did not pay for it learns the wrong thing
 * about what is being sold here.
 */
export function LiveHour({ data }: { data: LiveHourData }) {
  const [clicks, setClicks] = useState(data.clicks);
  const isSold = Boolean(data.displayName && data.slotId);

  useEffect(() => {
    if (!isSold) return;
    const poll = setInterval(() => {
      fetch("/api/board", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const json = (await res.json()) as { live?: { clicks?: number } | null };
          if (typeof json.live?.clicks === "number") setClicks(json.live.clicks);
        })
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(poll);
  }, [isSold]);

  return (
    <section className="flex min-h-[60svh] flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs uppercase tracking-[0.35em] text-faint">
        Right now
        <span className="mx-2">·</span>
        <LocalTime iso={data.startsAtIso} mode="range" />
        {isSold ? (
          <>
            <span className="mx-2">·</span>
            <span className="text-accent">
              <Countdown endsAtIso={data.endsAtIso} />
            </span>
          </>
        ) : null}
      </p>

      {isSold ? (
        <>
          <h1 className="mt-10 text-5xl font-semibold tracking-tight sm:text-7xl">
            {data.displayName}
          </h1>
          {data.pitch ? (
            <p className="mx-auto mt-6 max-w-2xl text-xl leading-relaxed text-muted sm:text-2xl">
              {data.pitch}
            </p>
          ) : null}
          <a
            href={`/r/${data.slotId}`}
            onClick={() =>
              vemetric.trackEvent("live_visit_clicked", { eventData: { slotId: data.slotId } })
            }
            className={`mt-12 ${CTA}`}
          >
            Visit {data.displayName} <span aria-hidden>→</span>
          </a>
          <p className="mt-6 text-sm text-faint">
            <span className="tabular">{clicks.toLocaleString()}</span> click
            {clicks === 1 ? "" : "s"} this hour
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-10 text-4xl font-semibold tracking-tight sm:text-6xl">
            This hour is empty.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
            Claim a spot and the next open hour is yours.
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("yourhour:focus-claim"))}
            className={`mt-12 ${CTA}`}
          >
            Claim your spot
          </button>
        </>
      )}
    </section>
  );
}
