"use client";

import { useCallback, useEffect, useRef } from "react";
import { vemetric } from "@vemetric/react";
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
  paidClicks: number;
  clicksDelivered: number;
  bonusClicks: number;
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

function focusClaim() {
  window.dispatchEvent(new Event("yourhour:focus-claim"));
}

export function LiveHour({ data }: { data: LiveCampaignData | null }) {
  const visitors = useVisitors();
  const { deliveredTotal, deliveredToday, live, refresh } = useClicks();
  const clicks = live && live.id === data?.id ? live.clicksDelivered : data?.clicksDelivered ?? 0;
  const bonusClicks = live && live.id === data?.id ? live.bonusClicks : data?.bonusClicks ?? 0;
  const guaranteedClicks = Math.max(0, clicks - bonusClicks);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if ((live?.id ?? null) !== (data?.id ?? null) || (live?.bonus ?? false) !== (data?.bonus ?? false)) window.location.reload();
  }, [live?.id, live?.bonus, data?.id, data?.bonus]);

  useEffect(() => {
    const pending = timeouts.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, []);

  const onVisit = useCallback(() => {
    if (!data) return;
    vemetric.trackEvent(data.bonus ? "bonus_visit_clicked" : "live_visit_clicked", { eventData: { campaignId: data.id } });
    [900, 3000].forEach((delay) => timeouts.current.push(setTimeout(refresh, delay)));
  }, [data, refresh]);

  const background = data ? productImageUrl(data.iconUrl, data.url) : null;
  const displayProductName = data ? heroProductName(data.productName) : "";
  const progress = data ? Math.min(100, (guaranteedClicks / Math.max(1, data.paidClicks)) * 100) : 0;
  const toGo = data ? Math.max(0, data.paidClicks - guaranteedClicks) : 0;

  return (
    <section
      id="now"
      className="landing-shell grid min-h-[calc(100svh-141px)] scroll-mt-40 items-center gap-14 py-10 md:py-20 lg:grid-cols-[.9fr_1.1fr] lg:gap-[7vw]"
    >
      <div className="order-2 text-center md:order-1 lg:text-left">
        <h1 className="mb-5 mt-0 text-[clamp(52px,6.2vw,92px)] font-normal leading-[.92] tracking-[-.075em]">
          One product.
          <br />
          <em className="not-italic text-violet">Every visitor.</em>
          <br />
          Until your clicks land.
        </h1>
        <p className="mx-auto max-w-[620px] text-[clamp(17px,1.5vw,20px)] leading-[1.55] tracking-[-.02em] text-muted lg:mx-0">
          You&apos;re not buying views or minutes. You&apos;re buying clicks. Your product owns this entire page — alone, no list, no competitors — until every one of them lands. However long that takes.
        </p>
        <div className="mt-14 flex flex-col items-center justify-center gap-5 sm:flex-row lg:justify-start">
          <button type="button" onClick={focusClaim} className={CTA}>
            Get clicks <ArrowIcon />
          </button>
          <a href="#how" className="text-sm font-bold text-muted hover:text-foreground">
            See how it works <span className="ml-1 text-accent">↓</span>
          </a>
        </div>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-xs text-faint lg:justify-start">
          <span><b className="text-foreground tabular">{deliveredToday.toLocaleString()}</b> clicks delivered today</span>
          <span><b className="text-foreground tabular">{deliveredTotal.toLocaleString()}</b> clicks delivered</span>
          <span><b className="text-foreground tabular">{visitors.toLocaleString()}</b> visitors since launch</span>
        </div>
      </div>

      <article className="relative order-1 flex min-h-[560px] flex-col overflow-hidden rounded-[30px] border border-violet/40 bg-[image:radial-gradient(circle_at_72%_16%,rgba(155,124,255,.28),transparent_32%),radial-gradient(circle_at_12%_84%,rgba(119,231,255,.14),transparent_30%)] bg-[#11131a] shadow-[0_25px_110px_rgba(58,35,140,.26)] md:order-2">
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
                <span className="text-faint">Paid for <b className="font-medium text-muted">{data.paidClicks.toLocaleString()}</b> clicks</span>
                <span className="text-faint">·</span>
                <span className="text-faint">delivered <b className={`ml-1 text-xl font-semibold ${bonusClicks > 0 ? "text-accent" : "text-muted"}`}>{clicks.toLocaleString()}</b></span>
              </div>
              <p className="mt-6 max-w-[500px] leading-relaxed text-[#b7bbc4]">Nobody&apos;s in the queue, so our top product keeps the page. Paste your link and it&apos;s yours instantly.</p>
              <button type="button" onClick={focusClaim} className={`mt-6 ${CTA}`}>Get clicks — from $5 <ArrowIcon /></button>
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
                  <span className="tabular">{guaranteedClicks.toLocaleString()} of {data.paidClicks.toLocaleString()} clicks delivered</span>
                  <span className="tabular">{toGo.toLocaleString()} to go</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-[clamp(42px,5vw,65px)] font-normal leading-[.95] tracking-[-.055em]">The next product here is yours.</h2>
              <p className="mt-4 max-w-md leading-relaxed text-[#b7bbc4]">Paste your link and you&apos;re live in under a minute. Nobody&apos;s ahead of you, so your clicks start the moment you pay.</p>
              <button type="button" onClick={focusClaim} className={`mt-8 ${CTA}`}>Get clicks — from $5 <ArrowIcon /></button>
            </>
          )}
        </div>
      </article>
    </section>
  );
}
