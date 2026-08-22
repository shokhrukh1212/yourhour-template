import Link from "next/link";
import { formatPrice } from "@/lib/pricing";
import type { WallEntry } from "@/lib/wall";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";
import { WallJoinForm } from "./WallJoinForm";

/**
 * The permanent leaderboard, ranked by money and never reset. It replaces the old
 * reverse-chronological archive, which rewarded nothing: here paying more is the only
 * thing that moves you up, and nothing that happens later can move you down.
 *
 * The product name is a direct, dofollow anchor. Everything else on the page routes
 * clicks through /w/:id so the counts stay honest -- but the permanent backlink is part
 * of what was bought, and a 302 passes no SEO value.
 */
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
  // Only the actual top of the Wall gets the large treatment; page 2 is all rows.
  const podium = page === 1 ? entries.slice(0, 3) : [];
  const rest = page === 1 ? entries.slice(3) : entries;
  const firstRank = (page - 1) * WALL_PAGE_SIZE + 1;

  return (
    <section id="wall" className="mx-auto w-full max-w-2xl scroll-mt-8 px-6 pb-24">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-faint">
          The Wall
        </h3>
        {total > 0 ? (
          <p className="text-xs text-faint">
            {total.toLocaleString()} {total === 1 ? "entry" : "entries"} · permanent
          </p>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-6 text-center text-muted">
          Nobody is on The Wall yet. The first entry stays rank #1 until someone
          outbids it.
        </p>
      ) : null}

      {podium.length > 0 ? (
        <div className="space-y-3">
          {podium.map((entry, i) => (
            <PodiumCard key={entry.id} entry={entry} rank={i + 1} />
          ))}
        </div>
      ) : null}

      {rest.length > 0 ? (
        <ul
          className={`divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface ${
            podium.length > 0 ? "mt-3" : ""
          }`}
        >
          {rest.map((entry, i) => (
            <WallRow
              key={entry.id}
              entry={entry}
              rank={firstRank + podium.length + i}
            />
          ))}
        </ul>
      ) : null}

      {totalPages > 1 ? (
        <nav className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={`/?wall=${page - 1}#wall`} className="text-accent hover:underline">
              ← Higher up
            </Link>
          ) : (
            <span />
          )}
          <span className="text-faint tabular">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/?wall=${page + 1}#wall`} className="text-accent hover:underline">
              Further down →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <WallJoinForm wallAmounts={wallAmounts} />
    </section>
  );
}

function PodiumCard({ entry, rank }: { entry: WallEntry; rank: number }) {
  return (
    <article
      className={`rounded-2xl border bg-surface p-6 ${
        rank === 1 ? "border-accent" : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <span
          className={`text-sm font-semibold tabular ${
            rank === 1 ? "text-accent" : "text-faint"
          }`}
        >
          #{rank}
        </span>
        <span className="text-2xl font-semibold tabular">
          {formatPrice(entry.amount_paid)}
        </span>
      </div>

      <h4 className="mt-3 text-xl font-semibold tracking-tight">
        <a
          href={entry.url ?? "#"}
          target="_blank"
          rel="noopener"
          className="hover:text-accent hover:underline"
        >
          {entry.display_name}
        </a>
      </h4>

      {entry.gifter_handle ? (
        <p className="mt-1 text-xs text-faint">gifted by {entry.gifter_handle}</p>
      ) : null}

      {entry.pitch ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{entry.pitch}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
        {entry.url ? (
          <a
            href={`/w/${entry.id}`}
            target="_blank"
            rel="noopener"
            className="rounded-full border border-accent px-5 py-1.5 font-medium text-accent transition-colors hover:bg-accent-soft"
          >
            Visit <span aria-hidden="true">↗</span>
          </a>
        ) : null}
        <span className="text-faint tabular">
          {entry.total_clicks.toLocaleString()} clicks
        </span>
        {entry.slug ? (
          <Link href={`/u/${entry.slug}`} className="text-faint hover:text-accent">
            Their page
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function WallRow({ entry, rank }: { entry: WallEntry; rank: number }) {
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
      <span className="w-10 shrink-0 text-faint tabular">#{rank}</span>
      <span className="min-w-0 flex-1 truncate">
        <a
          href={entry.url ?? "#"}
          target="_blank"
          rel="noopener"
          className="font-medium hover:text-accent hover:underline"
        >
          {entry.display_name}
        </a>
        {entry.gifter_handle ? (
          <span className="ml-2 text-xs text-faint">gifted by {entry.gifter_handle}</span>
        ) : null}
      </span>
      <span className="shrink-0 font-medium tabular">
        {formatPrice(entry.amount_paid)}
      </span>
      <Link
        href={entry.slug ? `/u/${entry.slug}` : "#"}
        className="hidden shrink-0 text-faint tabular hover:text-accent sm:block"
      >
        {entry.total_clicks.toLocaleString()} clicks
      </Link>
      <a
        href={`/w/${entry.id}`}
        target="_blank"
        rel="noopener"
        className="shrink-0 text-faint hover:text-accent"
        aria-label={`Visit ${entry.display_name ?? "this product"}`}
      >
        <span aria-hidden="true">↗</span>
      </a>
    </li>
  );
}
