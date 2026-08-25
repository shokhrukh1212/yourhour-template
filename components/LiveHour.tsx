"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { useClicks } from "@/components/ClicksProvider";
import { ProductLogo, productImageUrl } from "@/components/ProductLogo";
import { useVisitors } from "@/components/VisitorsProvider";

export type LiveCampaignData = {
  id: string;
  productName: string;
  pitch: string | null;
  url: string;
  iconUrl: string | null;
  accountingStatus: "verified" | "manual_reconciled" | "legacy_total_only";
  purchasedClicks: number | null;
  guaranteedClicksDelivered: number | null;
  bonusClicksDelivered: number;
  totalClicksDelivered: number;
  bonus: boolean;
};

const CTA =
  "inline-flex h-[50px] items-center justify-center gap-2.5 rounded-[14px] bg-accent px-5 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_42px_rgba(215,255,103,.2)]";

// Keep the featured card stable: a submitted product name may be up to 60
// characters, which is more than the hero's large display type can support.
const HERO_PRODUCT_NAME_MAX = 42;

function heroProductName(name: string): string {
  const characters = Array.from(name.trim());
  if (characters.length <= HERO_PRODUCT_NAME_MAX) return name;

  const cut = characters.slice(0, HERO_PRODUCT_NAME_MAX - 1).join("").trimEnd();
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > HERO_PRODUCT_NAME_MAX / 2 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.\-]+$/, "")}…`;
}

export function LiveHour({ data }: { data: LiveCampaignData | null }) {
  const visitors = useVisitors();
  const { deliveredTotal, deliveredLast24h, live, notifyClick } = useClicks();
  const clicks = live && live.id === data?.id ? live.clicksDelivered : data?.totalClicksDelivered ?? 0;
  const bonusClicks = live && live.id === data?.id ? live.bonusClicks : data?.bonusClicksDelivered ?? 0;
  const guaranteedClicks = data?.guaranteedClicksDelivered === null || data?.guaranteedClicksDelivered === undefined
    ? Math.max(0, clicks - bonusClicks)
    : Math.max(data.guaranteedClicksDelivered, clicks - bonusClicks);

  useEffect(() => {
    if ((live?.id ?? null) !== (data?.id ?? null) || (live?.bonus ?? false) !== (data?.bonus ?? false)) window.location.reload();
  }, [live?.id, live?.bonus, data?.id, data?.bonus]);

  const onVisit = useCallback(() => {
    if (data) notifyClick();
  }, [data, notifyClick]);

  // A paid campaign still working through the clicks it bought leads on small screens —
  // that delivery is what the buyer paid for. Once it is only earning bonus clicks (or
  // nothing is live), the pitch takes the top spot back. Desktop keeps pitch-then-card.
  const featuredLeadsOnMobile = data !== null && !data.bonus;

  const background = data ? productImageUrl(data.iconUrl, data.url) : null;
  const displayProductName = data ? heroProductName(data.productName) : "";
  const progress = data?.purchasedClicks ? Math.min(100, (guaranteedClicks / Math.max(1, data.purchasedClicks)) * 100) : 0;
  const toGo = data?.purchasedClicks ? Math.max(0, data.purchasedClicks - guaranteedClicks) : 0;

  return (
    <section
      id="now"
      className="landing-shell grid min-h-[calc(100svh-141px)] scroll-mt-40 items-center gap-14 py-10 md:py-20 lg:grid-cols-[1fr_1.1fr] lg:gap-[2.5vw]"
    >
      <div className={`text-center [container-type:inline-size] lg:order-1 lg:text-left ${featuredLeadsOnMobile ? "order-2" : "order-1"}`}>
        {/* Each line is a fixed row of the headline, so the type is sized from this column's
            width (cqw) rather than the viewport: the longest row always fits without wrapping.
            The coefficient is set from the widest font in the .landing-page stack. */}
        <h1 className="mb-5 mt-0 text-[clamp(24px,9.4cqw,64px)] font-normal leading-[1.03] tracking-[-.075em] lg:text-[clamp(24px,11.4cqw,76px)]">
          <span className="block whitespace-nowrap">One featured product.</span>
          <span className="block whitespace-nowrap text-violet">Visible to everyone.</span>
          <span className="block whitespace-nowrap">Until its purchased</span>
          <span className="block whitespace-nowrap">visits are delivered.</span>
        </h1>
        <p className="mx-auto max-w-[620px] text-[clamp(17px,1.5vw,20px)] leading-[1.55] tracking-[-.02em] text-muted lg:mx-0">
          Feature your product on the homepage and pay only for valid visitor click-throughs. Visitors choose whether to open the featured product.
        </p>
        <div className="mt-14 flex flex-col items-center justify-center gap-5 sm:flex-row lg:justify-start">
          <Link href="/get-clicks" className={CTA}>Feature your product — from $5 <ArrowIcon /></Link>
          <a href="#how" className="text-sm font-bold text-muted hover:text-foreground">
            See how it works <span className="ml-1 text-accent">↓</span>
          </a>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs text-faint lg:justify-start">
          <span><b className="text-foreground tabular">{deliveredLast24h.toLocaleString()}</b> clicks in the last 24h</span>
          <span><b className="text-foreground tabular">{deliveredTotal.toLocaleString()}</b> clicks so far</span>
          <span><b className="text-foreground tabular">{visitors.toLocaleString()}</b> visitors since launch</span>
        </div>
      </div>

      <article className={`relative flex min-h-[560px] flex-col overflow-hidden rounded-[30px] border border-violet/40 bg-[image:radial-gradient(circle_at_72%_16%,rgba(155,124,255,.28),transparent_32%),radial-gradient(circle_at_12%_84%,rgba(119,231,255,.14),transparent_30%)] bg-[#11131a] shadow-[0_25px_110px_rgba(58,35,140,.26)] lg:order-2 ${featuredLeadsOnMobile ? "order-1" : "order-2"}`}>
        {background ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={background} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="landing-product-backdrop absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
        ) : null}
        <div className="landing-grid-mask absolute inset-0" aria-hidden="true" />
        <div className="absolute right-[-120px] top-[30px] h-[420px] w-[420px] rounded-full border border-white/10" aria-hidden="true" />
        <div className="absolute right-[-60px] top-[90px] h-[300px] w-[300px] rounded-full border border-accent/[.18]" aria-hidden="true" />

        <div className="relative z-10 border-b border-border px-6 py-5 text-xs">
          <span className="inline-flex items-center gap-2 font-extrabold tracking-[.14em] text-emerald-300">
            <i className="live-dot h-[7px] w-[7px] rounded-full bg-live" aria-hidden="true" />
            {data?.bonus ? "BONUS ROUND" : data ? "LIVE NOW" : "OPEN NOW"}
          </span>
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-start justify-center px-7 py-10 sm:px-14">
          {data?.bonus ? (
            <>
              <ProductLogo imageUrl={data.iconUrl} productUrl={data.url} productName={data.productName} className="h-16 w-16 rounded-[19px] text-[28px] shadow-[0_18px_35px_rgba(98,65,196,.36)]" eager />
              <h2 title={data.productName} className="mb-2 mt-5 line-clamp-2 break-words text-[clamp(42px,5vw,65px)] font-normal leading-none tracking-[-.055em]">{displayProductName}</h2>
              {data.pitch ? <p className="max-w-[480px] leading-relaxed text-[#b7bbc4]">{data.pitch}</p> : null}
              <a href={`/r/${data.id}?bonus=1`} target="_blank" rel="noopener" onClick={onVisit} aria-label={`Visit ${data.productName} (opens in a new tab)`} title={`Visit ${data.productName}`} className="mt-8 flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-[15px] bg-accent px-6 py-4 text-lg font-extrabold text-accent-ink shadow-[0_15px_44px_rgba(215,255,103,.2)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_54px_rgba(215,255,103,.28)] sm:h-16 sm:py-0">
                <span className="min-w-0 truncate">Visit {displayProductName}</span> <ArrowIcon className="h-5 w-5 shrink-0" />
              </a>
              <div className="mt-4 flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-sm tabular">
                {data.accountingStatus === "legacy_total_only" ? (
                  <span className="text-faint"><b className="text-xl font-semibold text-accent">{clicks.toLocaleString()}</b> total clicks received</span>
                ) : (
                  <><span className="text-faint">Purchased: <b className="text-muted">{data.purchasedClicks?.toLocaleString()}</b></span><span className="text-faint">·</span><span className="text-faint">Delivered: <b className="text-muted">{guaranteedClicks.toLocaleString()}/{data.purchasedClicks?.toLocaleString()}</b></span><span className="text-faint">· Bonus: <b className="text-accent">{bonusClicks.toLocaleString()}</b> · Total: <b className="text-foreground">{clicks.toLocaleString()}</b></span></>
                )}
              </div>
              <p className="mt-6 max-w-[500px] leading-relaxed text-[#b7bbc4]">Nobody&apos;s in the queue, so an eligible delivered product is receiving extra traffic. Bonus clicks are not guaranteed.</p>
              <div className="mt-6"><p className="mb-2 text-sm font-semibold">Want clicks for your product?</p><Link href="/get-clicks" className={CTA}>Feature your product — from $5 <ArrowIcon /></Link></div>
            </>
          ) : data ? (
            <>
              <ProductLogo imageUrl={data.iconUrl} productUrl={data.url} productName={data.productName} className="h-16 w-16 rounded-[19px] text-[28px] shadow-[0_18px_35px_rgba(98,65,196,.36)]" eager />
              <h2 title={data.productName} className="mb-2 mt-5 line-clamp-2 break-words text-[clamp(42px,5vw,65px)] font-normal leading-none tracking-[-.055em]">{displayProductName}</h2>
              {data.pitch ? <p className="max-w-[480px] leading-relaxed text-[#b7bbc4]">{data.pitch}</p> : null}
              <a href={`/r/${data.id}`} target="_blank" rel="noopener" onClick={onVisit} aria-label={`Visit ${data.productName} (opens in a new tab)`} title={`Visit ${data.productName}`} className="mt-8 flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-[15px] bg-accent px-6 py-4 text-lg font-extrabold text-accent-ink shadow-[0_15px_44px_rgba(215,255,103,.2)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_54px_rgba(215,255,103,.28)] sm:h-16 sm:py-0">
                <span className="min-w-0 truncate">Visit {displayProductName}</span> <ArrowIcon className="h-5 w-5 shrink-0" />
              </a>
              <div className="mt-4 w-full">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[.08]" aria-label={`${Math.round(progress)}% delivered`}>
                  <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-2 flex justify-between gap-4 text-xs text-muted">
                  <span className="tabular">{guaranteedClicks.toLocaleString()} of {data.purchasedClicks?.toLocaleString()} guaranteed clicks so far</span>
                  <span className="tabular">{toGo.toLocaleString()} to go</span>
                </div>
              </div>
              <div className="mt-7"><p className="mb-2 text-sm font-semibold">Want clicks for your product?</p><Link href="/get-clicks" className={CTA}>Feature your product — from $5 <ArrowIcon /></Link></div>
            </>
          ) : (
            <>
              <h2 className="text-[clamp(42px,5vw,65px)] font-normal leading-[.95] tracking-[-.055em]">The next product here is yours.</h2>
              <p className="mt-4 max-w-md leading-relaxed text-[#b7bbc4]">Paste your link and you&apos;re live in under a minute. Nobody&apos;s ahead of you, so your clicks start the moment you pay.</p>
              <Link href="/get-clicks" className={`mt-8 ${CTA}`}>Feature your product — from $5 <ArrowIcon /></Link>
            </>
          )}
        </div>
      </article>
    </section>
  );
}
