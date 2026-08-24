"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { ProductLogo } from "@/components/ProductLogo";
import { formatPrice, priceToOvertake } from "@/lib/pricing";
import type { WallEntry } from "@/lib/wall";
import { WALL_PAGE_SIZE, rankForAmount } from "@/lib/wall-rank";

/** Background refresh for the counts, so other people's clicks land without a reload. */
const POLL_MS = 60_000;

/**
 * A tracked link opens in a new tab, so the redirect that records the click happens
 * after this handler returns. Read the counts twice: once for a fast redirect, once for
 * a slow one.
 */
const AFTER_CLICK_MS = [900, 3000];

/** The permanent leaderboard, rendered with the same card hierarchy as the reference. */
export function Wall({
  entries,
  page,
  totalPages,
  total,
  wallAmounts,
}: {
  entries: WallEntry[];
  page: number;
  totalPages: number;
  total: number;
  wallAmounts: number[];
}) {
  const firstRank = (page - 1) * WALL_PAGE_SIZE + 1;
  const ids = entries.map((entry) => entry.id).join(",");

  // Only counts this component has fetched itself live here; anything not in the map
  // falls back to what the server rendered. Tagging them with the page's ids is what
  // discards them when the reader pages to a different set of cards.
  const [live, setLive] = useState<{ ids: string; clicks: Record<string, number> }>({
    ids,
    clicks: {},
  });
  if (live.ids !== ids) setLive({ ids, clicks: {} });

  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  const refresh = useCallback(() => {
    if (!ids) return;
    fetch(`/api/wall/clicks?ids=${encodeURIComponent(ids)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { clicks?: Record<string, number> };
        if (!data.clicks) return;
        setLive((current) =>
          // A reply that arrives after the reader has paged away describes other cards.
          current.ids === ids
            ? { ids, clicks: { ...current.clicks, ...data.clicks } }
            : current,
        );
      })
      .catch(() => {
        // A stale count is not worth surfacing; the next read catches up.
      });
  }, [ids]);

  // The click itself is recorded by /w/[entryId] in the tab that just opened, so the
  // only way to show it here is to ask again once it has had time to land.
  const onTrackedClick = useCallback(() => {
    AFTER_CLICK_MS.forEach((delay) => {
      timeouts.current.push(setTimeout(refresh, delay));
    });
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    const pending = timeouts.current;
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      pending.forEach(clearTimeout);
      pending.length = 0;
    };
  }, [refresh]);

  return (
    <section id="wall" className="landing-shell scroll-mt-40 pb-36">
      <div className="mb-12 grid items-end gap-6 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
        <div>
          <span className="landing-eyebrow">The permanent leaderboard</span>
          <h2 className="mt-3 text-[clamp(40px,5vw,66px)] font-normal leading-[.97] tracking-[-.055em]">
            Pay once.
            <br />
            Stay on the Wall forever.
          </h2>
        </div>
        <p className="max-w-md leading-relaxed text-muted">
          Bid more to rise. Your product is never deleted—even when someone takes your
          rank.
        </p>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-[22px] border border-border bg-surface p-8 text-center text-muted">
          <p className="text-lg font-semibold text-foreground">The Wall is ready for #1.</p>
          <p className="mt-2">The first product stays permanently, even after someone pays more.</p>
        </div>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2">
          {entries.map((entry, index) => {
            const rank = firstRank + index;
            return (
              <WallCard
                key={entry.id}
                entry={entry}
                rank={rank}
                featured={page === 1 && index === 0}
                wallAmounts={wallAmounts}
                clicks={live.clicks[entry.id] ?? entry.total_clicks}
                onTrackedClick={onTrackedClick}
              />
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`/?wall=${page - 1}#wall`} className="font-semibold text-accent hover:underline">
              ← Higher up
            </Link>
          ) : (
            <span />
          )}
          <span className="text-faint tabular">
            Page {page} of {totalPages} · {total.toLocaleString()} products
          </span>
          {page < totalPages ? (
            <Link href={`/?wall=${page + 1}#wall`} className="font-semibold text-accent hover:underline">
              Further down →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <p className="mt-6 text-center text-xs text-faint">
        <span className="mr-2 text-lg text-violet">∞</span>
        Nobody is ever removed from the Wall.
      </p>
    </section>
  );
}

function WallCard({
  entry,
  rank,
  featured,
  wallAmounts,
  clicks,
  onTrackedClick,
}: {
  entry: WallEntry;
  rank: number;
  featured: boolean;
  wallAmounts: number[];
  clicks: number;
  onTrackedClick: () => void;
}) {
  const takePrice = priceToOvertake(entry.amount_paid);
  const canTakeThisRank = rankForAmount(wallAmounts, takePrice) === rank;

  return (
    <article
      className={`flex min-w-0 flex-col rounded-[22px] border bg-surface transition hover:-translate-y-0.5 hover:border-white/20 ${
        featured
          ? "min-h-[260px] border-accent/40 bg-[linear-gradient(90deg,rgba(215,255,103,.07),transparent_58%),#101219] p-8 md:col-span-2"
          : "min-h-[230px] border-border p-6"
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span className={`text-[13px] font-extrabold tabular ${featured ? "text-accent" : "text-faint"}`}>
          #{rank}
        </span>
        <strong className="text-3xl tracking-tight tabular">{formatPrice(entry.amount_paid)}</strong>
      </div>

      <div className="mt-6 flex min-w-0 items-start gap-4">
        <ProductLogo
          imageUrl={entry.image_url}
          productUrl={entry.url}
          productName={entry.display_name}
        />
        <div className="min-w-0">
          <h3 className="truncate text-xl font-normal tracking-tight">
            {entry.url ? (
              // Both links on a card go through /w, so the name is counted exactly like
              // the Visit button rather than sending untracked traffic to the buyer.
              <a
                href={`/w/${entry.id}`}
                target="_blank"
                rel="noopener"
                onClick={onTrackedClick}
                className="hover:text-accent"
              >
                {entry.display_name ?? "Unnamed product"}
              </a>
            ) : (
              (entry.display_name ?? "Unnamed product")
            )}
          </h3>
          {entry.pitch ? (
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted">{entry.pitch}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-4 pt-7 text-xs text-faint">
        {entry.url ? (
          <a
            href={`/w/${entry.id}`}
            target="_blank"
            rel="noopener"
            onClick={onTrackedClick}
            className="inline-flex items-center gap-2 font-bold text-foreground hover:text-accent"
          >
            Visit <ArrowIcon />
          </a>
        ) : null}
        <span className="tabular">
          {clicks.toLocaleString()} click{clicks === 1 ? "" : "s"}
        </span>
        {canTakeThisRank ? <TakeRankButton rank={rank} amountCents={takePrice} /> : null}
      </div>
    </article>
  );
}

function TakeRankButton({ rank, amountCents }: { rank: number; amountCents: number }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("yourhour:take-rank", { detail: { rank, amountCents } }),
        )
      }
      className="ml-auto min-h-[34px] rounded-[10px] border border-white/20 px-3 font-bold text-foreground transition hover:border-accent hover:text-accent"
    >
      Take #{rank} · {formatPrice(amountCents)}
    </button>
  );
}
