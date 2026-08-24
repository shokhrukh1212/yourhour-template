"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { vemetric } from "@vemetric/react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { useClicks } from "@/components/ClicksProvider";
import { Logo } from "@/components/Logo";
import { CLICK_PACKAGES, CLICK_RATE_CENTS, CLICK_STEP, DEFAULT_CLICKS, MAX_CLICKS, MIN_CLICKS, MIN_ENTRY_CENTS, clickPackageForInput, formatClickRate, formatPrice, priceForClicks } from "@/lib/pricing";
import { rankForAmount } from "@/lib/wall-rank";

type Preview = {
  url: string;
  productName: string;
  pitch: string | null;
  imageUrl: string | null;
  scraped: boolean;
  owned: boolean;
  existing: {
    id: string;
    product_name: string;
    amount_paid_cents: number;
    status: "queued" | "live" | "delivered";
    rank: number;
    queue_position: number | null;
  } | null;
};

type JumpSelection = { campaignId: string; productName: string; priceCents: number };
const PRICE_STEP_CLICKS = 100 / CLICK_RATE_CENTS;

export function ClaimBar({
  wallAmounts,
  statsUrl,
  queueLength,
  outstandingClicks,
  rollingClicksPerHour,
}: {
  wallAmounts: number[];
  statsUrl?: string;
  queueLength: number;
  outstandingClicks: number;
  rollingClicksPerHour: number;
}) {
  const { deliveredTotal } = useClicks();
  const panelId = useId();
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [clickInput, setClickInput] = useState(String(DEFAULT_CLICKS));
  const [limitNote, setLimitNote] = useState<string | null>(null);
  const [jump, setJump] = useState<JumpSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const urlRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const claimRef = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    setJump(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const reveal = useCallback((focusInput = true) => {
    claimRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(true);
    requestAnimationFrame(() => (focusInput ? urlRef.current?.focus() : closeRef.current?.focus()));
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    const focus = () => {
      setJump(null);
      reveal(true);
    };
    const jumpQueue = (event: Event) => {
      const detail = (event as CustomEvent<JumpSelection>).detail;
      if (!detail) return;
      setJump(detail);
      setError(null);
      reveal(false);
    };
    window.addEventListener("yourhour:focus-claim", focus);
    window.addEventListener("yourhour:jump-queue", jumpQueue);
    return () => {
      window.removeEventListener("yourhour:focus-claim", focus);
      window.removeEventListener("yourhour:jump-queue", jumpQueue);
    };
  }, [reveal]);

  const numericClicks = /^\d+$/.test(clickInput) ? Number(clickInput) : null;
  const clicks = numericClicks ?? DEFAULT_CLICKS;
  const invalidClicks = numericClicks === null || clicks < MIN_CLICKS || clicks > MAX_CLICKS;
  const matchingPackage = clickPackageForInput(clickInput) !== null;
  const clickPrice = priceForClicks(clicks);
  const existing = preview?.existing ?? null;
  const totalPlacementAmount = existing ? existing.amount_paid_cents + clickPrice : clickPrice;
  const checkoutCents = clickPrice;
  const targetRank = rankForAmount(wallAmounts, totalPlacementAmount);
  const queuePosition = existing?.queue_position ?? queueLength + 1;
  const startsEstimate = existing?.status === "live"
    ? "now"
    : estimateStart(outstandingClicks, rollingClicksPerHour);

  async function loadPreview(): Promise<Preview | null> {
    if (!url.trim() || loading) return null;
    setJump(null);
    setLoading(true);
    setError(null);
    setOpen(true);
    setPreview(null);
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json()) as Preview & { error?: string };
      if (!response.ok) {
        setError(json.error ?? "We couldn't read that link.");
        return null;
      }
      setPreview(json);
      setName(json.productName);
      setPitch(json.pitch ?? "");
      if (json.existing && !json.owned) {
        setError("This product already has a private owner. Open its receipt on the original device to make changes.");
      }
      vemetric.trackEvent("claim_opened", { eventData: { scraped: json.scraped } });
      return json;
    } catch {
      setError("Network error. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function onPreview(event: React.FormEvent) {
    event.preventDefault();
    await loadPreview();
  }

  async function beginCheckout(payload: Record<string, unknown>, amountCents: number) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not start checkout. Try again.");
        return;
      }
      vemetric.trackEvent("checkout_started", { eventData: { amountCents, mode: String(payload.mode) } });
      window.location.assign(json.checkoutUrl);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onPay(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (jump) {
      void beginCheckout({ mode: "jump", campaignId: jump.campaignId }, jump.priceCents);
      return;
    }
    if (invalidClicks) {
      clampClicks();
      return;
    }
    const selectedPreview = preview ?? await loadPreview();
    if (!selectedPreview || (selectedPreview.existing && !selectedPreview.owned)) return;
    void beginCheckout({
      mode: "purchase",
      url: selectedPreview.url,
      clicks,
      name: selectedPreview.scraped ? undefined : selectedPreview.productName || name || undefined,
      pitch: selectedPreview.scraped ? undefined : selectedPreview.pitch || pitch || undefined,
      twclid: new URLSearchParams(window.location.search).get("twclid") || undefined,
    }, checkoutCents);
  }

  function clampClicks() {
    if (numericClicks === null) {
      setClickInput(String(MIN_CLICKS));
      setLimitNote(`Minimum ${formatPrice(MIN_ENTRY_CENTS)} (${MIN_CLICKS} clicks)`);
      return;
    }
    if (numericClicks < MIN_CLICKS) {
      setClickInput(String(MIN_CLICKS));
      setLimitNote(`Minimum ${formatPrice(MIN_ENTRY_CENTS)} (${MIN_CLICKS} clicks)`);
    } else if (numericClicks > MAX_CLICKS) {
      setClickInput(String(MAX_CLICKS));
      setLimitNote(`Maximum ${MAX_CLICKS} clicks per order`);
    } else {
      setClickInput(String(numericClicks));
      setLimitNote(null);
    }
  }

  function stepClicks(direction: -1 | 1, step = CLICK_STEP) {
    setClickInput(String(Math.min(MAX_CLICKS, Math.max(MIN_CLICKS, clicks + direction * step))));
    setLimitNote(null);
  }

  const formattedDelivered = deliveredTotal.toLocaleString("en-US");

  return (
    <>
      {open ? <button type="button" aria-label="Close purchase panel" className="fixed inset-0 z-40 cursor-default border-0 bg-black/75 backdrop-blur-md" onClick={close} /> : null}
      <header ref={claimRef} id="claim" className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-2xl">
        <div className="landing-shell flex h-[62px] items-center justify-between">
          <Link href="/#now" className="inline-flex items-center gap-2.5 text-[17px] font-bold tracking-[-.035em]"><Logo className="h-[25px] w-[25px]" /><span>yourhour<span className="text-faint">.lol</span></span></Link>
          <nav className="flex items-center gap-4 text-[13px] text-muted sm:gap-5 lg:gap-7">
            <span aria-label={`${formattedDelivered} clicks delivered`} className="inline-flex items-baseline gap-1 whitespace-nowrap text-[11px] text-faint"><b className="text-[14px] font-semibold text-muted tabular">{formattedDelivered}</b> clicks delivered</span>
            {statsUrl ? <a href={statsUrl} target="_blank" rel="noopener" className="hidden hover:text-foreground sm:block">Stats</a> : null}
            <a href="#wall" className="hidden hover:text-foreground sm:block">Leaderboard</a>
            <a href="#how" className="hidden hover:text-foreground sm:block">How it works</a>
          </nav>
        </div>
        <div className="landing-shell relative">
          <form onSubmit={onPreview} className="grid min-h-[78px] grid-cols-[1fr_auto] items-center gap-3">
            <label className="relative"><span className="sr-only">Your product URL</span><span className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 text-sm text-faint sm:block">https://</span><input ref={urlRef} id="claim-url" name="url" type="text" inputMode="url" autoComplete="url" required value={url} onChange={(event) => { setUrl(event.target.value); setPreview(null); setError(null); }} onFocus={() => { setJump(null); setOpen(true); }} placeholder="Paste your product URL" aria-controls={panelId} className="h-[50px] w-full rounded-[14px] border border-border bg-white/[.045] px-4 text-foreground outline-none transition placeholder:text-faint focus:border-violet focus:bg-white/[.07] sm:pl-[76px]" /></label>
            <button ref={triggerRef} type="submit" disabled={loading} className="inline-flex h-[50px] w-[50px] items-center justify-center gap-2.5 rounded-[14px] border-0 bg-accent px-0 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto sm:px-5"><span className="hidden sm:inline">{loading ? "Reading…" : "Get clicks"}</span><ArrowIcon /></button>
          </form>

          {open ? (
            <div id={panelId} role="dialog" aria-modal="true" aria-label="Get clicks" className="landing-claim-panel absolute inset-x-0 top-full rounded-b-3xl border border-white/[.18] bg-surface p-5 shadow-2xl sm:p-7">
              <div className="flex items-start justify-between gap-5 border-b border-border pb-5">
                <div><span className="landing-eyebrow">Get clicks</span><h2 className="mt-2 text-2xl font-normal tracking-[-.05em] sm:text-4xl">{jump ? "Move to the front of the queue." : "Put your product in front of every visitor."}</h2></div>
                <button ref={closeRef} type="button" onClick={close} aria-label="Close purchase panel" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-white/[.04] text-2xl leading-none text-muted transition hover:border-white/20 hover:text-foreground">×</button>
              </div>

              {jump ? (
                <form onSubmit={onPay} className="mx-auto max-w-2xl py-12 text-center">
                  <p className="text-xl leading-relaxed">Move to the front of the queue — {formatPrice(jump.priceCents)}.</p>
                  <p className="mt-3 text-muted">Your clicks start immediately after the product that&apos;s live now.<br />This also adds {formatPrice(jump.priceCents)} to your leaderboard total.</p>
                  {error ? <p role="alert" className="mx-auto mt-6 max-w-lg rounded-[13px] bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p> : null}
                  <button type="submit" disabled={submitting} className="mt-7 inline-flex h-[50px] items-center justify-center gap-2 rounded-[14px] bg-accent px-8 font-extrabold text-accent-ink disabled:opacity-45">{submitting ? "Starting checkout…" : `Pay ${formatPrice(jump.priceCents)}`} <ArrowIcon /></button>
                </form>
              ) : (
                <form onSubmit={onPay} className="grid gap-7 pt-6 lg:grid-cols-[1.25fr_.75fr]">
                  <div className="space-y-5">
                    <label className="block sm:hidden">
                      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.12em] text-faint">Your product URL</span>
                      <input
                        id="claim-url-mobile"
                        name="mobile-url"
                        type="text"
                        inputMode="url"
                        autoComplete="url"
                        required
                        value={url}
                        onChange={(event) => { setUrl(event.target.value); setPreview(null); setError(null); }}
                        placeholder="https://yourproduct.com"
                        className="h-12 w-full rounded-[13px] border border-border bg-black/25 px-4 text-foreground outline-none transition placeholder:text-faint focus:border-violet focus:bg-white/[.04]"
                      />
                    </label>
                    <PanelRow label="How many clicks" hint={`Packages from ${CLICK_PACKAGES[0]} · custom from ${formatPrice(MIN_ENTRY_CENTS)}`}>
                      <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_52px] gap-1 rounded-[14px] border border-border bg-black/25 p-1">
                        {CLICK_PACKAGES.map((option) => <button key={option} type="button" aria-pressed={numericClicks === option} onClick={() => { setClickInput(String(option)); setLimitNote(null); }} className={`h-[42px] rounded-[10px] transition ${numericClicks === option ? "bg-violet font-bold text-white shadow-[0_10px_28px_rgba(98,65,196,.25)]" : "text-muted hover:bg-white/[.05] hover:text-foreground"}`}>{option}</button>)}
                        <span className={`grid h-[42px] place-items-center text-[10px] font-bold uppercase tracking-wider text-accent transition-opacity ${matchingPackage ? "opacity-0" : "opacity-100"}`}>Custom</span>
                      </div>
                      <div className="mt-7 grid gap-3 sm:grid-cols-2">
                        <div>
                          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.12em] text-faint">Clicks</span>
                          <div className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-[13px] border border-border bg-black/25">
                            <button type="button" aria-label="Decrease clicks" onClick={() => stepClicks(-1)} className="h-12 border-r border-border bg-white/[.04] text-xl text-muted hover:text-foreground">−</button>
                            <label><span className="sr-only">Custom click amount</span><input type="number" inputMode="numeric" min={MIN_CLICKS} max={MAX_CLICKS} step={1} value={clickInput} onChange={(event) => { setClickInput(event.target.value.replace(/\D/g, "")); setLimitNote(null); }} onBlur={clampClicks} className="click-count-input h-12 w-full bg-transparent px-3 text-center text-lg font-semibold tabular outline-none" /></label>
                            <button type="button" aria-label="Increase clicks" onClick={() => stepClicks(1)} className="h-12 border-l border-border bg-white/[.04] text-xl text-muted hover:text-foreground">+</button>
                          </div>
                        </div>
                        <div>
                          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[.12em] text-faint">Price</span>
                          <div className="grid grid-cols-[44px_1fr_44px] overflow-hidden rounded-[13px] border border-border bg-black/25">
                            <button type="button" aria-label="Decrease price" onClick={() => stepClicks(-1, PRICE_STEP_CLICKS)} className="h-12 border-r border-border bg-white/[.04] text-xl text-muted hover:text-foreground">−</button>
                            <output aria-live="polite" className="grid h-12 place-items-center px-3 text-lg font-semibold tabular">{formatPrice(clickPrice)}</output>
                            <button type="button" aria-label="Increase price" onClick={() => stepClicks(1, PRICE_STEP_CLICKS)} className="h-12 border-l border-border bg-white/[.04] text-xl text-muted hover:text-foreground">+</button>
                          </div>
                        </div>
                      </div>
                      <p className={`mt-1 min-h-4 text-xs ${limitNote ? "text-accent" : "text-transparent"}`}>{limitNote ?? "Within purchase limits"}</p>
                    </PanelRow>
                  </div>

                  <aside className="rounded-[20px] border border-accent/20 bg-gradient-to-br from-accent/[.08] to-violet/[.07] p-5">
                    <div className="flex items-center justify-between border-b border-border pb-4 text-xs uppercase tracking-[.13em] text-muted"><span>Your placement</span><strong className="text-[24px] text-accent tabular">{existing?.status === "live" ? "LIVE" : `#${queuePosition} in queue`}</strong></div>
                    <ul className="my-4 space-y-4 text-[13px]"><Benefit title={`${clicks} clicks`}>Delivered to your link, guaranteed</Benefit><Benefit title="The whole homepage">Your product alone, until every click lands</Benefit><Benefit title={`Permanent leaderboard rank #${targetRank}`}>Your listing stays visible forever</Benefit><Benefit title="Live tracking">Watch the counter as clicks arrive</Benefit></ul>
                    {error ? <p role="alert" className="mb-3 rounded-[13px] bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p> : null}
                    <div className="flex items-baseline justify-between border-t border-border py-4 text-sm text-muted"><span>{clicks} × {formatClickRate()}</span><strong className="text-3xl text-foreground tabular">{formatPrice(checkoutCents)}</strong></div>
                    <p className="mb-4 text-xs text-faint">Starts {startsEstimate === "now" ? "now" : startsEstimate === "—" ? "—" : `in ${startsEstimate}`}</p>
                    <button type="submit" disabled={submitting || loading || !url.trim() || Boolean(existing && !preview?.owned) || invalidClicks || checkoutCents <= 0} className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-accent font-extrabold text-accent-ink transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45">{submitting || loading ? "Preparing checkout…" : `Continue to pay ${formatPrice(checkoutCents)}`} <ArrowIcon /></button>
                    <small className="mt-2.5 block text-center text-faint">Delivered within 7 days or we refund the difference.</small>
                  </aside>
                </form>
              )}
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
}

function PanelRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <div className="grid items-start gap-2 sm:grid-cols-[150px_1fr] sm:gap-5"><span className="flex justify-between text-[13px] font-semibold sm:flex-col sm:gap-1"><span>{label}</span><small className="font-normal text-faint">{hint}</small></span><div className="min-w-0">{children}</div></div>;
}

function Benefit({ title, children }: { title: string; children: React.ReactNode }) {
  return <li className="flex gap-3"><i className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 not-italic text-accent">✓</i><span><b>{title}</b><small className="block text-faint">{children}</small></span></li>;
}

function estimateStart(outstanding: number, perHour: number): string {
  if (outstanding <= 0) return "now";
  if (!(perHour > 0)) return "—";
  const value = outstanding / perHour;
  if (value < 24) return `~${Math.max(1, Math.round(value))}h`;
  const days = Math.max(1, Math.round(value / 24));
  return `~${days} ${days === 1 ? "day" : "days"}`;
}
