"use client";

import { useEffect, useState } from "react";
import { vemetric } from "@vemetric/react";
import { LIVE_CLAIM_WINDOW_MS } from "@/lib/time";
import { useNow } from "@/lib/use-client-time";
import { Countdown } from "./Countdown";
import { LocalTime } from "./LocalTime";

export type EncoreData = {
  slotId: string;
  displayName: string;
  url: string | null;
  pitch: string | null;
};

export type LiveHourData = {
  slotId: string | null;
  startsAtIso: string;
  endsAtIso: string;
  nowIso: string;
  displayName: string | null;
  url: string | null;
  pitch: string | null;
  clicks: number;
  priceLabel: string;
  encore: EncoreData | null;
  nextOpen: { startsAtIso: string; priceLabel: string } | null;
};

const CTA =
  "inline-flex items-center gap-2 rounded-full bg-accent px-10 py-4 text-lg font-medium text-white transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent";

/**
 * The whole screen. Spec section 2: one product, one sentence, one button, one countdown.
 *
 * Three states, and none of them tells the visitor the product failed:
 *   A  the hour is sold          -- the buyer owns the screen
 *   B  open, first 15 minutes    -- it is still for sale, right now
 *   C  open, past 15 minutes     -- encore: the best past buyer gets it free
 */
export function LiveHour({ data }: { data: LiveHourData }) {
  const [clicks, setClicks] = useState(data.clicks);
  const isSold = Boolean(data.slotId && data.displayName);

  // The B -> C flip happens mid-hour, so it is decided on the ticking client clock
  // rather than at render time. Before hydration the server's clock stands in.
  const clientNow = useNow();
  const now = clientNow !== 0 ? clientNow : new Date(data.nowIso).getTime();
  const elapsed = now - new Date(data.startsAtIso).getTime();
  const stillClaimable = elapsed < LIVE_CLAIM_WINDOW_MS;

  // With no past buyer yet there is no encore to give, so the offer simply stays up.
  const showEncore = !isSold && !stillClaimable && data.encore !== null;

  // The live click counter is what the buyer screenshots. Spec section 4.
  useEffect(() => {
    if (!isSold) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { live?: { clicks?: number } };
        if (typeof json.live?.clicks === "number") setClicks(json.live.clicks);
      } catch {
        // A failed poll is not worth surfacing; the next one will catch up.
      }
    }, 30_000);
    return () => clearInterval(id);
  }, [isSold]);

  return (
    <section className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.5em] text-faint">
        Right now
        {showEncore ? (
          <>
            <span className="mx-2 text-border">·</span>
            <span className="text-accent">Encore</span>
          </>
        ) : null}
      </p>

      <p className="mt-5 text-sm text-muted">
        <LocalTime iso={data.startsAtIso} mode="range" />
        <span className="mx-2 text-border">·</span>
        <span className="font-medium text-accent">
          <Countdown endsAtIso={data.endsAtIso} />
        </span>
      </p>

      {isSold ? (
        <>
          <h1 className="mt-12 text-5xl font-semibold tracking-tight sm:text-7xl">
            {data.displayName}
          </h1>
          {data.pitch ? (
            <p className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted sm:text-2xl">
              {data.pitch}
            </p>
          ) : null}

          <a
            href={`/r/${data.slotId}`}
            target="_blank"
            rel="noopener"
            onClick={() => vemetric.trackEvent("live_visit_clicked")}
            className={`mt-12 ${CTA}`}
          >
            Visit <span aria-hidden="true">→</span>
          </a>

          <p className="mt-8 text-sm text-faint tabular">
            {clicks.toLocaleString()} {clicks === 1 ? "click" : "clicks"}
          </p>
        </>
      ) : showEncore && data.encore ? (
        <>
          <h1 className="mt-12 text-5xl font-semibold tracking-tight sm:text-7xl">
            {data.encore.displayName}
          </h1>
          {data.encore.pitch ? (
            <p className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted sm:text-2xl">
              {data.encore.pitch}
            </p>
          ) : null}

          <a
            href={`/r/${data.encore.slotId}?encore=1`}
            target="_blank"
            rel="noopener"
            onClick={() => vemetric.trackEvent("encore_visit_clicked")}
            className={`mt-12 ${CTA}`}
          >
            Visit {data.encore.displayName} <span aria-hidden="true">→</span>
          </a>

          <p className="mt-8 max-w-lg text-balance text-sm text-faint">
            Nobody claimed this hour, so our top past buyer gets it free.
          </p>

          {data.nextOpen ? (
            <p className="mt-10 flex flex-wrap items-center justify-center gap-4 text-lg text-muted">
              <span>
                Next open hour:{" "}
                <span className="font-medium text-foreground">
                  <LocalTime iso={data.nextOpen.startsAtIso} />
                </span>{" "}
                — <span className="font-medium text-accent">{data.nextOpen.priceLabel}</span>
              </span>
              <a
                href="#claim"
                className="rounded-full border border-accent px-5 py-1.5 text-base font-medium text-accent transition-colors hover:bg-accent-soft"
              >
                Claim
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <>
          <h1 className="mt-12 text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Own this homepage for 60 minutes.
          </h1>
          <p className="mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted sm:text-2xl">
            One product. The whole screen. No list, no competitors.
          </p>

          <p className="mt-12 text-lg text-muted">
            This hour is open right now —{" "}
            <span className="font-medium text-accent">{data.priceLabel}</span>
          </p>

          <a href="#claim" className={`mt-6 ${CTA}`}>
            Claim this hour
          </a>

          <p className="mt-6 text-sm text-faint">Live in 60 seconds.</p>
        </>
      )}
    </section>
  );
}
