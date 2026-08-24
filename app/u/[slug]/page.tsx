import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveStats } from "@/components/LiveStats";
import { LocalTime } from "@/components/LocalTime";
import { numberOnePrice } from "@/lib/pricing";
import { getWallEntryBySlug, getWallTopAmount } from "@/lib/wall";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const entry = await getWallEntryBySlug(slug);
  if (!entry?.display_name) return { title: "Not found" };

  const title = `${entry.display_name} is on The Wall at yourhour.lol`;

  return {
    title: entry.display_name,
    description: entry.pitch ?? undefined,
    openGraph: {
      type: "article",
      title,
      description: entry.pitch ?? undefined,
      url: `/u/${entry.slug}`,
      // The receipt card. Pasting this link on X renders it with no download step.
      images: [{ url: `/card/${entry.slug}.png`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: entry.pitch ?? undefined,
      images: [`/card/${entry.slug}.png`],
    },
  };
}

export default async function BuyerPage({ params }: Params) {
  const { slug } = await params;
  const [entry, topAmount] = await Promise.all([
    getWallEntryBySlug(slug),
    getWallTopAmount(),
  ]);

  if (!entry || !entry.display_name) notFound();

  const hours = entry.slots;
  const first = hours[0] ?? null;
  const isUpcoming = first ? new Date(first.starts_at) > new Date() : false;

  const eyebrow = isUpcoming ? "Upcoming hour" : "On The Wall";

  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">
          ← yourhour
        </Link>

        <p className="mt-10 text-[0.7rem] font-medium uppercase tracking-[0.4em] text-faint">
          {eyebrow}
        </p>

        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          {entry.display_name}
        </h1>

        {entry.pitch ? (
          <p className="mt-4 text-lg leading-relaxed text-muted">{entry.pitch}</p>
        ) : null}

        {hours.length > 0 ? (
          <div className="mt-6 space-y-1 text-sm text-faint">
            {hours.map((slot: (typeof hours)[number]) => {
              const iso = new Date(slot.starts_at).toISOString();
              return (
                <p key={slot.id}>
                  <LocalTime iso={iso} mode="range" className="tabular" />
                  <span className="mx-2 text-border">·</span>
                  <LocalTime iso={iso} mode="date" />
                </p>
              );
            })}
          </div>
        ) : null}

        <LiveStats
          slug={entry.slug!}
          initialClicks={entry.total_clicks}
          initialNumberOne={numberOnePrice(topAmount)}
          pricePaid={entry.amount_paid}
          rank={entry.rank}
        />

        {entry.url ? (
          // Counted, unlike the Wall's direct anchor: traffic arriving here is real
          // interest in the product and belongs in the number the buyer shows people.
          <a
            href={`/w/${entry.id}`}
            target="_blank"
            rel="noopener"
            className="mt-10 inline-flex items-center gap-2 rounded-full bg-accent px-8 py-3.5 font-medium text-accent-ink transition-transform hover:scale-[1.03]"
          >
            Visit {entry.display_name} <span aria-hidden="true">→</span>
          </a>
        ) : null}

        <div className="mt-12 border-t border-border pt-6">
          <p className="text-sm text-faint">
            This page, its click count and its place on The Wall stay up for as long as
            this site exists. Nobody is ever removed.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/#claim"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:border-accent hover:text-accent"
            >
              Claim your own spot <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/#wall"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:border-accent hover:text-accent"
            >
              See The Wall
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
