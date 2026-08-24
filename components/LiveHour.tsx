"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { vemetric } from "@vemetric/react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Countdown } from "@/components/Countdown";
import { LocalTime } from "@/components/LocalTime";
import { ProductLogo, productImageUrl } from "@/components/ProductLogo";
import { useVisitors } from "@/components/VisitorsProvider";
import { MIN_ENTRY_CENTS, formatPrice } from "@/lib/pricing";
import type { TopClickedProduct } from "@/lib/wall";

export type LiveHourData = {
  slotId: string | null;
  startsAtIso: string;
  endsAtIso: string;
  displayName: string | null;
  url: string | null;
  pitch: string | null;
  imageUrl: string | null;
  /** Clicks this hour has earned while it has been on screen. */
  clicks: number;
};

const CTA =
  "inline-flex h-[50px] items-center justify-center gap-2.5 rounded-[14px] bg-accent px-5 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_42px_rgba(215,255,103,.2)]";

function focusClaim() {
  window.dispatchEvent(new Event("yourhour:focus-claim"));
}

/** The evergreen pitch and the one product that owns the current hour. */
export function LiveHour({
  data,
  visits,
  wallTotal,
  topProduct,
}: {
  data: LiveHourData;
  /** What the server rendered. The cumulative number updates after the first poll. */
  visits: number;
  wallTotal: number;
  topProduct: TopClickedProduct | null;
}) {
  const visitors = useVisitors(visits);
  const [clicks, setClicks] = useState(data.clicks);
  const isSold = Boolean(data.displayName && data.slotId);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refresh = useCallback(() => {
    fetch("/api/board", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as { live?: { clicks?: number } | null };
        if (typeof json.live?.clicks === "number") setClicks(json.live.clicks);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isSold) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    const pending = timeouts.current;
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, [isSold, refresh]);

  // The link opens a new tab and /r/[slotId] records the click there, so the counter can
  // only move once that redirect has landed. Read twice to cover a slow one.
  const onVisit = useCallback(() => {
    vemetric.trackEvent("live_visit_clicked", { eventData: { slotId: data.slotId } });
    [900, 3000].forEach((delay) => {
      timeouts.current.push(setTimeout(refresh, delay));
    });
  }, [data.slotId, refresh]);

  const background = isSold ? productImageUrl(data.imageUrl, data.url) : null;

  return (
    <section
      id="now"
      className="landing-shell grid min-h-[calc(100svh-141px)] scroll-mt-40 items-center gap-14 py-20 lg:grid-cols-[.9fr_1.1fr] lg:gap-[7vw]"
    >
      <div className="text-center lg:text-left">
        <h1 className="mb-5 mt-0 text-[clamp(52px,6.2vw,92px)] font-normal leading-[.92] tracking-[-.075em]">
          One product.
          <br />
          <em className="not-italic text-violet">Every visitor.</em>
          <br />
          For one hour.
        </h1>
        <p className="mx-auto max-w-[560px] text-[clamp(17px,1.5vw,20px)] leading-[1.55] tracking-[-.02em] text-muted lg:mx-0">
          YourHour gives one product the entire homepage for 60 minutes—then keeps every
          buyer permanently ranked on the Wall.
        </p>
        <div className="mt-20 flex flex-col items-center justify-center gap-5 sm:flex-row lg:justify-start">
          <button type="button" onClick={focusClaim} className={CTA}>
            Claim the next hour <ArrowIcon />
          </button>
          <a href="#how" className="text-sm font-bold text-muted hover:text-foreground">
            See how it works <span className="ml-1 text-accent">↓</span>
          </a>
        </div>
        <div className="mt-9 grid grid-cols-3 gap-3 border-t border-border pt-5 text-xs text-faint sm:flex sm:justify-center sm:gap-6 lg:justify-start">
          <span>
            <b className="text-foreground tabular">{visitors.toLocaleString()}</b> visitors since launch
          </span>
          <span>
            <b className="text-foreground tabular">{wallTotal.toLocaleString()}</b> products on the
            Wall
          </span>
          <span>
            <b className="text-foreground">{formatPrice(MIN_ENTRY_CENTS)}</b> minimum
          </span>
        </div>
      </div>

      <article className="relative flex min-h-[560px] flex-col overflow-hidden rounded-[30px] border border-violet/40 bg-[image:radial-gradient(circle_at_72%_16%,rgba(155,124,255,.28),transparent_32%),radial-gradient(circle_at_12%_84%,rgba(119,231,255,.14),transparent_30%)] bg-[#11131a] shadow-[0_25px_110px_rgba(58,35,140,.26)]">
        {background ? (
          // Arbitrary product hosts cannot be enumerated in next/image remotePatterns.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={background}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="landing-product-backdrop absolute inset-0 h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        ) : null}
        <div className="landing-grid-mask absolute inset-0" aria-hidden="true" />
        <div
          className="absolute right-[-120px] top-[30px] h-[420px] w-[420px] rounded-full border border-white/10"
          aria-hidden="true"
        />
        <div
          className="absolute right-[-60px] top-[90px] h-[300px] w-[300px] rounded-full border border-accent/[.18]"
          aria-hidden="true"
        />

        <div className="relative z-10 flex items-center justify-between border-b border-border px-6 py-5 text-xs">
          <span className="inline-flex items-center gap-2 font-extrabold tracking-[.14em] text-emerald-300">
            <i className="live-dot h-[7px] w-[7px] rounded-full bg-live" aria-hidden="true" />
            {isSold ? "LIVE NOW" : "OPEN NOW"}
          </span>
          <span className="tabular text-muted">
            {isSold ? <Countdown endsAtIso={data.endsAtIso} /> : null}
          </span>
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-start justify-center px-7 py-12 sm:px-14">
          {isSold ? (
            <>
              <ProductLogo
                imageUrl={data.imageUrl}
                productUrl={data.url}
                productName={data.displayName}
                className="h-16 w-16 rounded-[19px] text-[28px] shadow-[0_18px_35px_rgba(98,65,196,.36)]"
                eager
              />
              <span className="mt-6 text-[10px] font-extrabold uppercase tracking-[.17em] text-aqua">
                This hour belongs to
              </span>
              <h2 className="my-2 text-[clamp(42px,5vw,65px)] font-normal leading-none tracking-[-.055em]">
                {data.displayName}
              </h2>
              {data.pitch ? (
                <p className="max-w-[480px] leading-relaxed text-[#b7bbc4]">{data.pitch}</p>
              ) : null}
              <a
                href={`/r/${data.slotId}`}
                target="_blank"
                rel="noopener"
                onClick={onVisit}
                className="mt-7 inline-flex h-12 items-center gap-2.5 rounded-[13px] border border-white/15 bg-white/[.08] px-[18px] text-sm font-bold transition hover:border-accent hover:text-accent"
              >
                Visit {data.displayName} <ArrowIcon />
              </a>
            </>
          ) : (
            <>
              <span className="landing-eyebrow">Available now</span>
              <h2 className="mt-3 text-[clamp(42px,5vw,65px)] font-normal leading-[.95] tracking-[-.055em]">
                This hour is open.
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-[#b7bbc4]">
                Claim it from {formatPrice(MIN_ENTRY_CENTS)} and put your product in front
                of every visitor for the full 60 minutes.
              </p>
              {topProduct ? <MostClickedProof product={topProduct} /> : null}
              <button type="button" onClick={focusClaim} className={`mt-6 ${CTA}`}>
                Claim this hour — from {formatPrice(MIN_ENTRY_CENTS)} <ArrowIcon />
              </button>
            </>
          )}
        </div>

        <div className="relative z-10 flex justify-between gap-4 border-t border-border px-6 py-5 text-xs text-muted">
          <LocalTime iso={data.startsAtIso} mode="range" className="tabular" />
          <span className="tabular">
            {isSold
              ? `${clicks.toLocaleString()} click${clicks === 1 ? "" : "s"} this hour`
              : "Ready for your product"}
          </span>
        </div>
      </article>
    </section>
  );
}

function MostClickedProof({ product }: { product: TopClickedProduct }) {
  const name = product.display_name ?? "Unnamed product";
  const clicks = product.total_clicks;

  return (
    <div className="mt-6 w-full max-w-md rounded-[16px] border border-white/[.12] bg-black/25 p-4">
      <span className="text-[9px] font-extrabold uppercase tracking-[.17em] text-violet">
        Most clicks so far
      </span>
      <div className="mt-3 flex min-w-0 items-center gap-3.5">
        <ProductLogo
          imageUrl={product.image_url}
          productUrl={product.url}
          productName={name}
          className="h-11 w-11 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold tracking-tight">{name}</p>
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-faint">
            <strong className="text-base font-semibold text-foreground tabular">
              {clicks.toLocaleString()} clicks
            </strong>
            <span className="tabular">Wall #{product.rank}</span>
          </p>
        </div>
        <a
          href={`/w/${product.id}`}
          target="_blank"
          rel="noopener"
          aria-label={`View ${name} (opens in a new tab)`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md text-[11px] font-bold text-muted transition hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        >
          <span className="hidden sm:inline">View product</span>
          <ArrowIcon className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
