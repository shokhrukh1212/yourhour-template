"use client";

import { useEffect, useRef, useState } from "react";
import { ProductLogo } from "./ProductLogo";
import { TakeSpotButton } from "./TakeSpotButton";
import { FEATURED_INTRO_KEY, useOvertake } from "./OvertakeProvider";

export type DisplayListing = { id: string; url: string; productName: string; pitch: string | null; iconUrl: string | null; bidCents: number; verifiedClicks: number; rank: number };

let introPlayedThisDocument = false;

export function FeaturedProduct({ listing }: { listing: DisplayListing }) {
  const cardRef = useRef<HTMLElement>(null);
  const [intro, setIntro] = useState(false);
  const motion = useOvertake();

  useEffect(() => {
    if (motion.hasPurchaseIntent) {
      introPlayedThisDocument = true;
      try { window.sessionStorage.setItem(FEATURED_INTRO_KEY, "1"); } catch { /* memory is enough */ }
      return;
    }
    if (introPlayedThisDocument || motion.kind !== "idle") return;
    try {
      if (window.sessionStorage.getItem(FEATURED_INTRO_KEY)) {
        introPlayedThisDocument = true;
        return;
      }
      window.sessionStorage.setItem(FEATURED_INTRO_KEY, "1");
    } catch {
      // Continue with the document marker when sessionStorage is unavailable.
    }
    introPlayedThisDocument = true;
    if (document.visibilityState !== "visible" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = window.requestAnimationFrame(() => setIntro(true));
    const timer = window.setTimeout(() => setIntro(false), 700);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [motion.hasPurchaseIntent, motion.kind]);

  const motionClass = motion.listingId === listing.id && motion.animate
    ? motion.kind === "takeover"
      ? " is-takeover-arrival"
      : motion.kind === "external"
        ? " is-external-update"
        : ""
    : motion.kind === "waiting" && motion.animate
      ? " is-takeover-waiting"
      : "";

  return (
    <article ref={cardRef} className={`featured-card${intro ? " is-initial-arrival" : ""}${motionClass}`} data-listing-id={listing.id}>
      <span className="featured-permanent-accent" aria-hidden="true" />
      <span className="featured-arrival-highlight" aria-hidden="true" />
      <span className="featured-needle-accent" aria-hidden="true" />
      <div className="featured-watermark"><ProductLogo imageUrl={listing.iconUrl} productUrl={listing.url} productName={listing.productName} className="h-full w-full border-0" /></div>
      <div className="featured-product" data-featured-content><ProductLogo eager imageUrl={listing.iconUrl} productUrl={listing.url} productName={listing.productName} className="featured-logo" /><div className="featured-copy"><span className="featured-kicker">CURRENT #1</span><h1><a href={`/r/${listing.id}`} target="_blank" rel="noopener">{listing.productName}</a></h1>{listing.pitch ? <p>{listing.pitch}</p> : null}</div></div>
      <dl className="featured-stats"><div><dd>${listing.bidCents / 100}</dd><dt>paid</dt></div><div><dd>{listing.verifiedClicks.toLocaleString()}</dd><dt>verified clicks</dt></div></dl>
      <div className="featured-action">
        <a className="visit-link" href={`/r/${listing.id}`} target="_blank" rel="noopener" aria-label={`Visit ${listing.productName} (opens in a new tab)`}>Visit <span aria-hidden="true">→</span></a>
        <TakeSpotButton className="mobile-take-inline" />
        <p>Featured until another product pays more.</p>
      </div>
    </article>
  );
}
