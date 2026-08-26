"use client";

import { useEffect, useRef, useState } from "react";
import { useBid } from "@/components/BidProvider";
import { initiateCheckoutEvent, trackMetaEvent } from "@/lib/meta-pixel";
import { normalizeDollarInput, STARTING_BID_CENTS } from "@/lib/pricing";
import { focusClaimForm } from "@/lib/scroll-to-claim";
import { checkProductUrl } from "@/lib/validate";

type Preview = {
  url: string; owned: boolean; existing: { id: string; bidCents: number } | null;
};

export function ClaimPanel({ empty = false }: { empty?: boolean }) {
  const [url, setUrl] = useState("");
  const { bidCents, minBidCents, rank, setBidCents } = useBid();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPreviewUrl = useRef("");
  const effectiveMinimum = Math.max(
    STARTING_BID_CENTS,
    preview?.existing ? preview.existing.bidCents + 100 : minBidCents,
  );
  const dollars = bidCents / 100;
  const [bidDraft, setBidDraft] = useState({ value: String(dollars), bidCents });
  const bidInput = bidDraft.bidCents === bidCents ? bidDraft.value : String(dollars);

  useEffect(() => {
    // Browsers commonly restore this page from the back-forward cache after a buyer
    // leaves Lemon Squeezy. React state is preserved in that case, so explicitly
    // release the loading button whenever the page becomes active again.
    const releaseCheckout = () => setBusy(false);
    const releaseCheckoutWhenVisible = () => {
      if (document.visibilityState === "visible") setBusy(false);
    };
    window.addEventListener("pageshow", releaseCheckout);
    document.addEventListener("visibilitychange", releaseCheckoutWhenVisible);
    return () => {
      window.removeEventListener("pageshow", releaseCheckout);
      document.removeEventListener("visibilitychange", releaseCheckoutWhenVisible);
    };
  }, []);

  useEffect(() => {
    setBidCents((current) => Math.max(current, effectiveMinimum));
  }, [effectiveMinimum, setBidCents]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    // An empty field is not a mistake worth reporting: put the caret in it so the
    // buyer can just start typing, which is what every other "Take #N" button does.
    if (!url.trim()) { focusClaimForm(); return; }
    const checked = checkProductUrl(url);
    if (!checked.ok) { setError(checked.error); focusClaimForm(); return; }
    setBusy(true); setError(null);
    try {
      let product = preview;
      if (!product || lastPreviewUrl.current !== checked.normalized) {
        const response = await fetch("/api/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: checked.normalized, actionId: crypto.randomUUID() }) });
        const json = await response.json() as Preview & { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not read that product URL.");
        if (json.existing && !json.owned) throw new Error("This product already has an owner. Use the original browser or contact support with your receipt.");
        product = json; setPreview(json); setUrl(json.url); lastPreviewUrl.current = json.url;
        const nextMinimum = json.existing ? json.existing.bidCents + 100 : STARTING_BID_CENTS;
        setBidCents((value) => Math.max(value, nextMinimum));
      }
      const target = Math.max(
        bidCents,
        minBidCents,
        product.existing ? product.existing.bidCents + 100 : STARTING_BID_CENTS,
      );
      const params = new URLSearchParams(window.location.search);
      const response = await fetch("/api/checkout", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: product.url, targetBidCents: target, twclid: params.get("twclid") || undefined }),
      });
      const json = await response.json() as { checkoutUrl?: string; intentId?: string; amountDueCents?: number; error?: string };
      if (!response.ok || !json.checkoutUrl) throw new Error(json.error ?? "Could not start checkout.");
      // Only once the server handed back a real checkout session: a rejected or failed
      // reservation throws above and reports nothing. The intent id keys the event, so
      // a reused checkout repeats one eventID instead of counting twice.
      const started = initiateCheckoutEvent(json, target);
      if (started) trackMetaEvent(started);
      window.location.assign(json.checkoutUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  function step(delta: number) { setBidCents((value) => Math.max(effectiveMinimum, value + delta)); setError(null); }
  function onAmountChange(event: React.ChangeEvent<HTMLInputElement>) {
    const normalized = normalizeDollarInput(event.target.value);
    if (normalized === null) return;
    const nextBidCents = normalized === "" ? bidCents : Number(normalized) * 100;
    setBidDraft({ value: normalized, bidCents: nextBidCents });
    if (normalized !== "" && nextBidCents >= effectiveMinimum) setBidCents(nextBidCents);
    setError(null);
  }
  function onAmountBlur() {
    const next = Math.max(effectiveMinimum, bidInput === "" ? 0 : Number(bidInput) * 100);
    setBidCents(next);
    setBidDraft({ value: String(next / 100), bidCents: next });
  }

  const label = rank === 1 && empty ? `Claim #1 for $${dollars}` : `Take #${rank} for $${dollars}`;
  const atMinimum = bidCents <= effectiveMinimum;
  const errorId = "product-url-error";
  return (
    <form id="claim" className={`claim-panel ${empty ? "empty-claim" : ""}`} onSubmit={submit} noValidate>
      {!empty ? <><h2>Take the homepage</h2><p className="claim-intro">Pay $1 more to take the homepage.</p></> : null}
      <label htmlFor="product-url">Product URL</label>
      <input id="product-url" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="url" placeholder="name.com or https://name.com" value={url} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={(event) => { setUrl(event.target.value); setPreview(null); setError(null); }} />
      <div className="bid-row">
        <button type="button" className="stepper-btn" aria-label={atMinimum ? `Minimum bid reached at $${effectiveMinimum / 100}; amount cannot be decreased` : "Decrease amount by one dollar"} disabled={atMinimum} onClick={() => step(-100)}>−</button>
        <div className="bid-amount"><span aria-hidden="true">$</span><input aria-label="Amount in dollars" type="text" inputMode="numeric" pattern="[0-9]*" value={bidInput} style={{ width: `${Math.max(1, bidInput.length)}ch` }} onChange={onAmountChange} onBlur={onAmountBlur} /></div>
        <button type="button" className="stepper-btn" aria-label="Increase amount by one dollar" onClick={() => step(100)}>+</button>
      </div>
      {error ? <p id={errorId} className="form-error" role="alert">{error}</p> : null}
      <button className="claim-button" type="submit" disabled={busy}>{busy ? "Preparing checkout…" : label}</button>
    </form>
  );
}
