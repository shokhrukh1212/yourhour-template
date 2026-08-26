"use client";

import { useState } from "react";
import { useBid } from "@/components/BidProvider";
import { ProductLogo } from "./ProductLogo";
import type { DisplayListing } from "./FeaturedProduct";

export function Leaderboard({ initial, total }: { initial: DisplayListing[]; total: number }) {
  const { chooseBid } = useBid();
  const [items, setItems] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function more() {
    setLoading(true);
    try {
      const response = await fetch(`/api/leaderboard?offset=${items.length}&limit=20`);
      const json = await response.json() as { items: Array<{ id: string; url: string; product_name: string; pitch: string | null; icon_url: string | null; bid_cents: number; verified_clicks: number; rank: number }> };
      setItems((current) => [...current, ...json.items.map((item) => ({ id: item.id, url: item.url, productName: item.product_name, pitch: item.pitch, iconUrl: item.icon_url, bidCents: item.bid_cents, verifiedClicks: item.verified_clicks, rank: item.rank }))]);
    } finally { setLoading(false); }
  }

  return (
    <section id="leaderboard" className="leaderboard-section">
      <div className="leaderboard-heading"><h2>Permanent leaderboard</h2><p>Every buyer stays. Ranked by total paid.</p></div>
      {items.length ? <div className="leaderboard-wrap"><ol className="leaderboard-list">
        {items.map((item) => <li key={item.id} className={item.rank === 1 ? "leader-row winner" : "leader-row"}>
          <span className="rank">{item.rank}</span>
          <div className="row-product">
            <ProductLogo imageUrl={item.iconUrl} productUrl={item.url} productName={item.productName} className="row-logo" />
            <div className="row-copy"><h3><a href={`/r/${item.id}`} target="_blank" rel="noopener">{item.productName}</a></h3>{item.pitch ? <p>{item.pitch}</p> : null}</div>
          </div>
          <strong className="row-paid">${item.bidCents / 100}</strong>
          <p className="row-clicks"><b>{item.verifiedClicks.toLocaleString()}</b> <span>clicks</span></p>
          <div className="row-actions"><a className="row-visit" href={`/r/${item.id}`} target="_blank" rel="noopener">Visit ↗</a><a className="beat" href={`/?target=${item.bidCents + 100}#claim`} onClick={(event) => { event.preventDefault(); chooseBid(item.bidCents + 100); }}>Beat for ${(item.bidCents + 100) / 100}</a></div>
        </li>)}
      </ol></div> : <div className="empty-board"><span aria-hidden="true">☷</span><h3>No products yet.</h3><p>The first buyer becomes #1.</p></div>}
      {items.length < total ? <button type="button" className="more-button" disabled={loading} onClick={more}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 9.5 5 5 5-5" /></svg>{loading ? "Loading…" : "More products"}</button> : null}
    </section>
  );
}
