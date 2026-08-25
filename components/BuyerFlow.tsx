"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowIcon } from "@/components/ArrowIcon";
import { ProductLogo } from "@/components/ProductLogo";
import { ScreenwarProof } from "@/components/ScreenwarProof";
import type { CampaignProof } from "@/lib/campaigns";
import { CLICK_PACKAGES, CLICK_STEP, DEFAULT_CHECKOUT_CLICKS, MAX_CLICKS, MIN_CLICKS, formatPrice, priceForClicks } from "@/lib/pricing";
import { checkProductUrl } from "@/lib/validate";

type Preview = {
  url: string;
  productName: string;
  pitch: string | null;
  imageUrl: string | null;
  scraped: boolean;
  owned: boolean;
  existing: { id: string; status: string } | null;
};

type Attribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
};

export function BuyerFlow({ screenwar }: { screenwar: CampaignProof | null }) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [clickInput, setClickInput] = useState(String(DEFAULT_CHECKOUT_CLICKS));
  const [priceInput, setPriceInput] = useState(String(priceForClicks(DEFAULT_CHECKOUT_CLICKS) / 100));
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionIdRef = useRef<string>("");
  const attributionRef = useRef<Attribution>(emptyAttribution());

  useEffect(() => {
    attributionRef.current = getAttribution();
    const key = `yourhour_buyer_view:${window.location.href}`;
    let eventId = window.sessionStorage.getItem(key);
    if (!eventId) {
      eventId = newActionId();
      window.sessionStorage.setItem(key, eventId);
    }
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "buyer_landing_viewed", eventId, attribution: attributionRef.current }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  async function submitUrl(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const check = checkProductUrl(url);
    if (!check.ok) {
      setUrlError(check.error);
      inputRef.current?.focus();
      return;
    }
    inputRef.current?.blur();
    setLoading(true);
    setUrlError(null);
    setOrderError(null);
    setPreview(null);
    const actionId = newActionId();
    actionIdRef.current = actionId;
    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: check.normalized, actionId, attribution: attributionRef.current }),
      });
      const json = await response.json() as Preview & { error?: string };
      if (!response.ok) {
        setUrlError(json.error ?? "We couldn't read that product URL. Check it and try again.");
        return;
      }
      if (json.existing && !json.owned) {
        setUrlError("This product already has a private owner. Use the original device or submit a different product URL.");
        return;
      }
      setUrl(json.url);
      setPreview(json);
      setReviewOpen(true);
    } catch {
      setUrlError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function chooseClicks(value: number) {
    setClickInput(String(value));
    setPriceInput(String(priceForClicks(value) / 100));
    setOrderError(null);
  }

  function applySelection(): number | null {
    const numericClicks = Number(clickInput);
    const numericPrice = Number(priceInput);
    if (!Number.isInteger(numericClicks) || numericClicks < MIN_CLICKS || numericClicks > MAX_CLICKS || numericClicks % CLICK_STEP !== 0) {
      setOrderError(`Choose ${MIN_CLICKS}–${MAX_CLICKS} clicks in increments of ${CLICK_STEP}.`);
      return null;
    }
    if (!Number.isInteger(numericPrice) || numericPrice < 5 || numericPrice > 50 || numericPrice * 100 !== priceForClicks(numericClicks)) {
      setOrderError("The amount must match the fixed $0.20-per-click price.");
      return null;
    }
    chooseClicks(numericClicks);
    return numericClicks;
  }

  function changeClickInput(raw: string) {
    const cleaned = raw.replace(/\D/g, "");
    setClickInput(cleaned);
    if (cleaned) setPriceInput(String(priceForClicks(Number(cleaned)) / 100));
    setOrderError(null);
  }

  function changePriceInput(raw: string) {
    const cleaned = raw.replace(/\D/g, "");
    setPriceInput(cleaned);
    if (cleaned) setClickInput(String(Number(cleaned) * 5));
    setOrderError(null);
  }

  function stepClicks(delta: number) {
    const current = Number(clickInput) || DEFAULT_CHECKOUT_CLICKS;
    chooseClicks(Math.max(MIN_CLICKS, Math.min(MAX_CLICKS, current + delta)));
  }

  function stepPrice(deltaDollars: number) {
    const current = Number(clickInput) || DEFAULT_CHECKOUT_CLICKS;
    chooseClicks(Math.max(MIN_CLICKS, Math.min(MAX_CLICKS, current + (deltaDollars * 5))));
  }

  async function beginCheckout() {
    if (!preview || submitting) return;
    const validatedClicks = applySelection();
    if (validatedClicks === null) return;
    setSubmitting(true);
    setOrderError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "purchase",
          url: preview.url,
          clicks: validatedClicks,
          name: preview.scraped ? undefined : preview.productName,
          pitch: preview.scraped ? undefined : preview.pitch,
          twclid: params.get("twclid") || undefined,
          attribution: attributionRef.current,
        }),
      });
      const json = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok || !json.checkoutUrl) {
        setOrderError(json.error ?? "Could not start secure checkout. Try again.");
        return;
      }
      window.location.assign(json.checkoutUrl);
    } catch {
      setOrderError("We couldn't start checkout. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const selectedClicks = Number(clickInput) || DEFAULT_CHECKOUT_CLICKS;
  const price = priceForClicks(selectedClicks);

  return (
    <section className="landing-shell grid items-start gap-8 py-9 sm:py-14 lg:grid-cols-[1.08fr_.92fr] lg:gap-16 lg:py-20" aria-labelledby="buyer-heading">
      <div className="min-w-0">
        <span className="landing-eyebrow">Featured product placement</span>
        <h1 id="buyer-heading" className="mt-4 max-w-[760px] text-[clamp(42px,6.5vw,78px)] font-normal leading-[.94] tracking-[-.065em]">
          Feature your product. <em className="not-italic text-violet">Pay only for valid visits.</em>
        </h1>
        <p className="mt-6 max-w-[650px] text-[clamp(17px,1.5vw,20px)] leading-[1.55] tracking-[-.02em] text-muted">
          Get 50 valid visits to your product for $10. Your product is featured on the homepage while eligible visitors voluntarily click through.
        </p>

        <form onSubmit={submitUrl} className="mt-8 max-w-[680px]" noValidate>
          <label htmlFor="buyer-url" className="mb-2 block text-sm font-semibold">Your product URL</label>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              ref={inputRef}
              id="buyer-url"
              name="url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="url"
              spellCheck={false}
              required
              value={url}
              onChange={(event) => { setUrl(event.target.value); setPreview(null); setUrlError(null); setOrderError(null); }}
              placeholder="https://yourproduct.com"
              aria-describedby={urlError ? "buyer-url-error" : undefined}
              aria-invalid={Boolean(urlError)}
              className="h-14 min-w-0 rounded-[15px] border border-border bg-white/[.045] px-4 text-[16px] text-foreground outline-none transition placeholder:text-faint focus:border-violet focus:ring-2 focus:ring-violet/20"
            />
            <button type="submit" disabled={loading} className="inline-flex min-h-14 min-w-[210px] items-center justify-center gap-2.5 rounded-[15px] bg-accent px-6 text-[15px] font-extrabold text-accent-ink shadow-[0_14px_42px_rgba(215,255,103,.16)] transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground disabled:opacity-55">
              {loading ? "Reading product…" : "Feature your product — from $5"} {!loading ? <ArrowIcon /> : null}
            </button>
          </div>
          {urlError ? <p id="buyer-url-error" role="alert" className="mt-3 rounded-[12px] bg-danger-soft px-4 py-3 text-sm text-danger">{urlError}</p> : null}
        </form>

        <p className="mt-5 flex max-w-[680px] flex-wrap gap-x-2 gap-y-1 text-[12px] leading-relaxed text-muted">
          <span>$0.20 per click</span><span aria-hidden="true">·</span><span>No account required</span><span aria-hidden="true">·</span><span>Live delivery tracking</span>
        </p>
      </div>

      <div className="lg:pt-3">
        {reviewOpen && preview ? (
          <>
            <button type="button" aria-label="Close order review" className="fixed inset-0 z-40 border-0 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setReviewOpen(false)} />
            <aside role="dialog" aria-modal="true" aria-label="Review your click order" className="buyer-review fixed inset-x-0 bottom-0 z-50 max-h-[86svh] overflow-y-auto rounded-t-[24px] border border-border bg-surface p-5 shadow-2xl lg:static lg:max-h-none lg:rounded-[26px] lg:p-7">
              <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
                <div><span className="landing-eyebrow">Review your order</span><h2 className="mt-2 text-2xl font-normal tracking-[-.045em]">Your product is ready.</h2></div>
                <button type="button" aria-label="Close order review" onClick={() => setReviewOpen(false)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-white/[.04] text-xl text-muted hover:text-foreground">×</button>
              </div>
              <div className="mt-5 flex min-w-0 items-start gap-4">
                <ProductLogo imageUrl={preview.imageUrl} productUrl={preview.url} productName={preview.productName} className="h-12 w-12 rounded-[13px]" />
                <div className="min-w-0"><h3 className="truncate text-lg font-semibold">{preview.productName}</h3><p className="mt-1 truncate text-xs text-faint">{preview.url}</p>{preview.pitch ? <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{preview.pitch}</p> : null}</div>
              </div>
              <fieldset className="mt-6">
                <legend className="text-xs font-bold uppercase tracking-[.13em] text-faint">Choose your visit balance</legend>
                <div className="mt-3 grid grid-cols-4 overflow-hidden rounded-[13px] border border-border bg-black/20">
                  {CLICK_PACKAGES.map((amount) => (
                    <button key={amount} type="button" aria-label={`Choose a balance of ${amount} visits`} aria-pressed={selectedClicks === amount} onClick={() => chooseClicks(amount)} className={`min-h-14 border-0 px-1 text-center text-base font-semibold tabular transition sm:text-lg ${selectedClicks === amount ? "rounded-[11px] bg-violet text-white shadow-[0_12px_30px_rgba(155,124,255,.2)]" : "text-muted hover:bg-white/[.04] hover:text-foreground"}`}>
                      {amount}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="order-clicks" className="block text-[11px] font-bold uppercase tracking-[.13em] text-faint">Clicks</label>
                    <span className="mt-2 grid min-h-14 grid-cols-[44px_1fr_44px] overflow-hidden rounded-[13px] border border-border bg-black/20 focus-within:border-violet focus-within:ring-2 focus-within:ring-violet/20">
                      <button type="button" aria-label="Decrease clicks by 10" disabled={selectedClicks <= MIN_CLICKS} onClick={() => stepClicks(-10)} className="min-h-11 border-r border-border text-xl text-muted transition hover:bg-white/[.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">−</button>
                      <input id="order-clicks" aria-label="Visit balance" type="text" inputMode="numeric" pattern="[0-9]*" value={clickInput} onChange={(event) => changeClickInput(event.target.value)} onBlur={applySelection} className="min-w-0 border-0 bg-transparent px-1 text-center text-[16px] font-semibold tabular text-foreground outline-none" />
                      <button type="button" aria-label="Increase clicks by 10" disabled={selectedClicks >= MAX_CLICKS} onClick={() => stepClicks(10)} className="min-h-11 border-l border-border text-xl text-muted transition hover:bg-white/[.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">+</button>
                    </span>
                  </div>
                  <div>
                    <label htmlFor="order-price" className="block text-[11px] font-bold uppercase tracking-[.13em] text-faint">Price</label>
                    <span className="mt-2 grid min-h-14 grid-cols-[44px_1fr_44px] overflow-hidden rounded-[13px] border border-border bg-black/20 focus-within:border-violet focus-within:ring-2 focus-within:ring-violet/20">
                      <button type="button" aria-label="Decrease price by one dollar" disabled={selectedClicks <= MIN_CLICKS} onClick={() => stepPrice(-1)} className="min-h-11 border-r border-border text-xl text-muted transition hover:bg-white/[.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">−</button>
                      <input id="order-price" aria-label="Order price in dollars" type="text" inputMode="numeric" pattern="[0-9]*" value={`$${priceInput}`} onChange={(event) => changePriceInput(event.target.value)} onBlur={applySelection} className="min-w-0 border-0 bg-transparent px-1 text-center text-[16px] font-semibold tabular text-foreground outline-none" />
                      <button type="button" aria-label="Increase price by one dollar" disabled={selectedClicks >= MAX_CLICKS} onClick={() => stepPrice(1)} className="min-h-11 border-l border-border text-xl text-muted transition hover:bg-white/[.04] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35">+</button>
                    </span>
                  </div>
                </div>
              </fieldset>
              {orderError ? <p role="alert" className="mt-4 rounded-[12px] bg-danger-soft px-4 py-3 text-sm text-danger">{orderError}</p> : null}
              <div className="sticky bottom-0 mt-5 border-t border-border bg-surface pt-5">
                <div className="mb-4 flex items-baseline justify-between"><span className="text-sm text-muted">{selectedClicks} × $0.20</span><strong className="text-3xl tabular">{formatPrice(price)}</strong></div>
                <button type="button" disabled={submitting} onClick={beginCheckout} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-[15px] bg-accent px-5 text-[15px] font-extrabold text-accent-ink transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foreground disabled:opacity-50">
                  {submitting ? "Starting secure checkout…" : `Continue to pay ${formatPrice(price)}`} {!submitting ? <ArrowIcon /> : null}
                </button>
                <p className="mt-2 text-center text-[11px] text-faint">Delivered within 7 days or refunded.</p>
              </div>
            </aside>
          </>
        ) : screenwar ? <ScreenwarProof proof={screenwar} /> : null}
      </div>
    </section>
  );
}

function emptyAttribution(): Attribution {
  return { utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrer: null };
}

function getAttribution(): Attribution {
  const storageKey = "yourhour_attribution";
  const params = new URLSearchParams(window.location.search);
  const current: Attribution = {
    utmSource: params.get("utm_source"),
    utmMedium: params.get("utm_medium"),
    utmCampaign: params.get("utm_campaign"),
    utmContent: params.get("utm_content"),
    utmTerm: params.get("utm_term"),
    referrer: document.referrer || null,
  };
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<Attribution> | null;
    const merged = Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value || stored?.[key as keyof Attribution] || null])) as Attribution;
    window.localStorage.setItem(storageKey, JSON.stringify(merged));
    return merged;
  } catch {
    return current;
  }
}

function newActionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `action-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
