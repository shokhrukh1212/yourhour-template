"use client";

import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { useClicks } from "@/components/ClicksProvider";
import { ProductLogo } from "@/components/ProductLogo";
import type { Campaign, PublicCampaign } from "@/lib/campaigns";
import { formatPrice } from "@/lib/pricing";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";

export type QueueCampaign = Omit<Campaign, "owner_token_hash"> & { eta: string };

export function Wall({
  entries,
  page,
  totalPages,
  total,
  queue,
  ownedCampaignIds,
  jumpPriceCents,
  basePath = "/",
}: {
  entries: PublicCampaign[];
  page: number;
  totalPages: number;
  total: number;
  queue: QueueCampaign[];
  ownedCampaignIds: string[];
  jumpPriceCents: number;
  basePath?: string;
}) {
  const firstRank = (page - 1) * WALL_PAGE_SIZE + 1;
  const { clicks, bonusClicks, notifyClick: onTrackedClick } = useClicks();

  const ownedQueued = queue.find((campaign) => campaign.status === "queued" && ownedCampaignIds.includes(campaign.id));

  return (
    <section id="wall" className="landing-shell scroll-mt-40 pb-36">
      <div className="mb-12 grid items-end gap-6 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
        <div><span className="landing-eyebrow">The permanent leaderboard</span><h2 className="mt-3 text-[clamp(40px,5vw,66px)] font-normal leading-[.97] tracking-[-.055em]">Pay once.<br />Stay listed forever.</h2></div>
        <p className="max-w-md leading-relaxed text-muted">Ranked by what you paid. Your listing and link stay visible even after your clicks are delivered.</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
        <div>
          {entries.length ? <div className="grid gap-3.5">{entries.map((entry, index) => <WallCard key={entry.id} entry={entry} rank={firstRank + index} featured={page === 1 && index === 0} clicks={clicks[entry.id] ?? entry.total_clicks_delivered} bonusClicks={bonusClicks[entry.id] ?? entry.bonus_clicks_delivered} onTrackedClick={onTrackedClick} />)}</div> : <div className="rounded-[22px] border border-border bg-surface p-8 text-center text-muted"><p className="text-lg font-semibold text-foreground">The leaderboard is ready for #1.</p><p className="mt-2">The first product stays listed permanently.</p></div>}
          {totalPages > 1 ? <nav className="mt-6 flex items-center justify-between text-sm">{page > 1 ? <Link href={`${basePath}?wall=${page - 1}#wall`} className="font-semibold text-accent hover:underline">← Higher up</Link> : <span />}<span className="text-faint tabular">Page {page} of {totalPages} · {total.toLocaleString()} products</span>{page < totalPages ? <Link href={`${basePath}?wall=${page + 1}#wall`} className="font-semibold text-accent hover:underline">Further down →</Link> : <span />}</nav> : null}
        </div>

        <aside className="overflow-hidden rounded-[22px] border border-violet/30 bg-surface lg:sticky lg:top-[165px]">
          <div className="border-b border-border p-6"><span className="landing-eyebrow">Up next</span><h3 className="mt-2 text-3xl font-normal tracking-[-.045em]">{queue.length} in the queue</h3></div>
          {queue.length ? <ol className="divide-y divide-border">{queue.map((campaign, index) => {
            const owned = ownedCampaignIds.includes(campaign.id);
            const delivered = clicks[campaign.id] ?? campaign.total_clicks_delivered;
            const bonus = bonusClicks[campaign.id] ?? campaign.bonus_clicks_delivered;
            const guaranteed = campaign.guaranteed_clicks_delivered === null ? 0 : Math.max(campaign.guaranteed_clicks_delivered, delivered - bonus);
            return <li key={campaign.id} className="p-4"><div className="grid grid-cols-[24px_38px_minmax(0,1fr)_auto] items-center gap-3"><b className="text-xs text-faint tabular">{index + 1}.</b><ProductLogo imageUrl={campaign.icon_url} productUrl={campaign.url} productName={campaign.product_name} className="h-9 w-9 rounded-[10px]" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{campaign.product_name}</p><p className="text-xs text-faint tabular"><b className="font-semibold text-muted">{guaranteed.toLocaleString()}</b>/{campaign.purchased_clicks?.toLocaleString() ?? "—"} delivered</p></div><span className={`text-xs tabular ${campaign.status === "live" ? "text-accent" : "text-muted"}`}>{campaign.status === "live" ? "live now" : campaign.eta}</span></div>{campaign.status === "queued" ? <div className="ml-[75px] mt-2 text-[11px] text-faint">Someone can jump ahead of you for {formatPrice(jumpPriceCents)}.{owned ? <button type="button" onClick={() => openJump(campaign, jumpPriceCents)} className="ml-2 font-bold text-accent hover:underline">Jump the queue — {formatPrice(jumpPriceCents)}</button> : null}</div> : null}</li>;
          })}</ol> : <p className="p-6 text-sm leading-relaxed text-muted">Nobody is waiting. Buy clicks and you go live immediately.</p>}
          {ownedQueued ? <div className="border-t border-border p-5"><button type="button" onClick={() => openJump(ownedQueued, jumpPriceCents)} className="flex w-full items-center justify-center gap-2 rounded-[13px] border border-accent/30 px-4 py-3 text-sm font-bold text-accent transition hover:bg-accent/10">Jump to the front for {formatPrice(jumpPriceCents)} <ArrowIcon /></button></div> : null}
        </aside>
      </div>
    </section>
  );
}

function WallCard({ entry, rank, featured, clicks, bonusClicks, onTrackedClick }: { entry: PublicCampaign; rank: number; featured: boolean; clicks: number; bonusClicks: number; onTrackedClick: () => void }) {
  const guaranteed = entry.guaranteed_clicks_delivered === null ? null : Math.max(entry.guaranteed_clicks_delivered, clicks - bonusClicks);
  return (
    <article className={`flex min-w-0 flex-col rounded-[22px] border bg-surface transition hover:-translate-y-0.5 hover:border-white/20 ${featured ? "min-h-[250px] border-accent/40 bg-[linear-gradient(90deg,rgba(215,255,103,.07),transparent_58%),#101219] p-8" : "min-h-[220px] border-border p-6"}`}>
      <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2"><span className={`text-[13px] font-extrabold tabular ${featured ? "text-accent" : "text-faint"}`}>#{rank}</span><StatusBadge status={entry.status} /></div><strong className="text-3xl tracking-tight tabular">{formatPrice(entry.amount_paid_cents)}</strong></div>
      <div className="mt-6 flex min-w-0 items-start gap-4"><ProductLogo imageUrl={entry.icon_url} productUrl={entry.url} productName={entry.product_name} /><div className="min-w-0"><h3 className="truncate text-xl font-normal tracking-tight"><a href={`/r/${entry.id}`} target="_blank" rel="noopener" onClick={onTrackedClick} className="hover:text-accent">{entry.product_name}</a></h3>{entry.pitch ? <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{entry.pitch}</p> : null}</div></div>
      <div className="mt-auto flex flex-wrap items-end gap-4 pt-7 text-xs text-faint"><a href={`/r/${entry.id}`} target="_blank" rel="noopener" onClick={onTrackedClick} className="mb-0.5 inline-flex min-h-11 items-center gap-2 font-bold text-foreground hover:text-accent">Visit <ArrowIcon /></a>{entry.accounting_status === "legacy_total_only" || entry.purchased_clicks === null || guaranteed === null ? <span className="tabular"><b className="text-lg font-semibold text-foreground">{clicks.toLocaleString()}</b> total clicks received</span> : <span className="leading-relaxed tabular">Purchased: <b className="text-foreground">{entry.purchased_clicks}</b> · Delivered: <b className="text-foreground">{guaranteed}/{entry.purchased_clicks}</b><br />Bonus: <b className="text-violet">{bonusClicks}</b> · Total: <b className="text-accent">{clicks}</b></span>}</div>
    </article>
  );
}

function StatusBadge({ status }: { status: PublicCampaign["status"] }) {
  const copy = status === "live" ? "LIVE" : status === "queued" ? "IN QUEUE" : "DELIVERED";
  const color = status === "live" ? "border-accent/30 bg-accent/10 text-accent" : status === "queued" ? "border-violet/30 bg-violet/10 text-violet" : "border-white/10 bg-white/[.04] text-faint";
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-extrabold tracking-wider ${color}`}>{copy}</span>;
}

function openJump(campaign: Pick<Campaign, "id" | "product_name">, priceCents: number) {
  window.dispatchEvent(new CustomEvent("yourhour:jump-queue", { detail: { campaignId: campaign.id, productName: campaign.product_name, priceCents } }));
}
