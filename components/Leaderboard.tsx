"use client";

import { useLayoutEffect, useRef, useState } from "react";
// import { useBid } from "@/components/BidProvider"; // Restore with row bid controls below.
import { ProductLogo } from "./ProductLogo";
import type { DisplayListing } from "./FeaturedProduct";
import { useOvertake } from "./OvertakeProvider";

export function Leaderboard({ initial, total }: { initial: DisplayListing[]; total: number }) {
  // const { chooseBid } = useBid(); // Restore with row bid controls below.
  const [loaded, setLoaded] = useState<DisplayListing[]>([]);
  const [loading, setLoading] = useState(false);
  const takeover = useOvertake();
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const previousRectsRef = useRef(new Map<string, DOMRect>());
  const previousRanksRef = useRef(new Map<string, number>());
  const animationsRef = useRef(new Map<string, Animation>());
  const refreshedIds = new Set(initial.map((item) => item.id));
  const items = [...initial, ...loaded.filter((item) => !refreshedIds.has(item.id))]
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const layoutKey = items.map((item) => `${item.id}:${item.rank}`).join("|");

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    const nextRanks = new Map<string, number>();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const visible = document.visibilityState === "visible";

    for (const item of items) {
      const row = rowRefs.current.get(item.id);
      if (!row) continue;
      const nextRect = row.getBoundingClientRect();
      nextRects.set(item.id, nextRect);
      nextRanks.set(item.id, item.rank);
      animationsRef.current.get(item.id)?.cancel();

      const previousRect = previousRectsRef.current.get(item.id);
      const deltaY = previousRect ? previousRect.top - nextRect.top : 0;
      if (!reduced && visible && Math.abs(deltaY) > 0.5) {
        const animation = row.animate([
          { transform: `translateY(${deltaY}px)` },
          { transform: "translateY(0)" },
        ], {
          duration: takeover.kind === "takeover" || takeover.kind === "waiting" ? 560 : 440,
          easing: "cubic-bezier(.2,.78,.22,1)",
        });
        animationsRef.current.set(item.id, animation);
      }

      const previousRank = previousRanksRef.current.get(item.id);
      const rank = row.querySelector<HTMLElement>(".rank");
      if (!reduced && visible && rank && previousRank !== undefined && previousRank !== item.rank) {
        const rankAnimationKey = `${item.id}:rank`;
        animationsRef.current.get(rankAnimationKey)?.cancel();
        const rankAnimation = rank.animate([
          { opacity: 0.25, transform: `translateY(${item.rank < previousRank ? 5 : -5}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 260, easing: "cubic-bezier(.2,.75,.3,1)" });
        animationsRef.current.set(rankAnimationKey, rankAnimation);
      }
    }

    previousRectsRef.current = nextRects;
    previousRanksRef.current = nextRanks;
  // `layoutKey` is the stable description of the ordering this FLIP pass measures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, takeover.kind]);

  useLayoutEffect(() => () => {
    for (const animation of animationsRef.current.values()) animation.cancel();
    animationsRef.current.clear();
  }, []);

  async function more() {
    setLoading(true);
    try {
      const response = await fetch(`/api/leaderboard?offset=${items.length}&limit=20`);
      const json = await response.json() as { items: Array<{ id: string; url: string; product_name: string; pitch: string | null; icon_url: string | null; bid_cents: number; verified_clicks: number; rank: number }> };
      setLoaded((current) => [...current, ...json.items.map((item) => ({ id: item.id, url: item.url, productName: item.product_name, pitch: item.pitch, iconUrl: item.icon_url, bidCents: item.bid_cents, verifiedClicks: item.verified_clicks, rank: item.rank }))]);
    } finally { setLoading(false); }
  }

  return (
    <section id="leaderboard" className="leaderboard-section">
      <div className="leaderboard-heading"><h2>Permanent leaderboard</h2><p>Every buyer stays. Ranked by total paid.</p></div>
      {items.length ? <div className="leaderboard-wrap"><ol className="leaderboard-list">
        {items.map((item) => {
          const active = takeover.listingId === item.id && takeover.animate;
          const motionClass = active && takeover.kind === "takeover"
            ? " is-takeover-row"
            : active && takeover.kind === "external"
              ? " is-external-row"
              : "";
          return <li
            key={item.id}
            ref={(node) => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}
            className={`${item.rank === 1 ? "leader-row winner" : "leader-row"}${motionClass}`}
            style={{ viewTransitionName: `leader-row-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}` }}
          >
          <a
            className="leaderboard-row-link"
            href={`/r/${item.id}`}
            target="_blank"
            rel="noopener"
            aria-label={`Visit ${item.productName}, rank ${item.rank}, $${item.bidCents / 100} paid (opens in a new tab)`}
          >
            <span className="rank">#{item.rank}</span>
            <ProductLogo imageUrl={item.iconUrl} productUrl={item.url} productName={item.productName} className="row-logo" />
            <span className="row-copy">
              <h3>
                <span className="row-title">{item.productName}</span>
                <span className="row-title-clicks"><span aria-hidden="true">·</span> {item.verifiedClicks.toLocaleString()} clicks</span>
              </h3>
              {item.pitch ? <span className="row-description">{item.pitch}</span> : null}
              <span className="row-mobile-clicks">{item.verifiedClicks.toLocaleString()} clicks</span>
            </span>
            <strong className="row-paid">${item.bidCents / 100}</strong>
          </a>
          {/* Row controls are intentionally commented out for the simplified MVP.
          <div className="row-footer">
            <div className="row-actions">
              <a className="row-visit" href={`/r/${item.id}`} target="_blank" rel="noopener" aria-label={`Visit ${item.productName} (opens in a new tab)`}>Visit <span aria-hidden="true">↗</span></a>
              <a className="beat" href={`/?target=${item.bidCents + 100}#claim`} aria-label={`Beat ${item.productName} for $${(item.bidCents + 100) / 100}`} onClick={(event) => { event.preventDefault(); chooseBid(item.bidCents + 100); }}>Beat for ${(item.bidCents + 100) / 100}</a>
            </div>
          </div>
          */}
        </li>;})}
      </ol></div> : <div className="empty-board"><span aria-hidden="true">☷</span><h3>No products yet.</h3><p>The first buyer becomes #1.</p></div>}
      {items.length < total ? <button type="button" className="more-button" disabled={loading} onClick={more}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 9.5 5 5 5-5" /></svg>{loading ? "Loading…" : "More products"}</button> : null}
    </section>
  );
}
