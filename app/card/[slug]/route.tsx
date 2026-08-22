import { ImageResponse } from "next/og";
import { CARD_SIZE, ReceiptCard } from "@/components/card/ReceiptCard";
import { numberOnePrice } from "@/lib/pricing";
import { getWallEntryBySlug, getWallTopAmount } from "@/lib/wall";

const HOUR_MS = 60 * 60 * 1000;

/**
 * The receipt card at its own URL, /card/{slug}.png, rather than Next's opengraph-image
 * convention -- the path is quoted to buyers and appears in emails, so it has to be
 * literal and readable.
 *
 * Not cached to disk: a Vercel function's filesystem is per-instance and wiped on cold
 * start, so a write would silently do nothing. The edge cache is the real equivalent.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const entry = await getWallEntryBySlug(slug.replace(/\.png$/, ""));

  // No card at all beats a card advertising an hour that does not exist.
  if (!entry || !entry.display_name) {
    return new Response("Not found", { status: 404 });
  }

  const topAmount = await getWallTopAmount();
  const firstHour = entry.slots[0] ? new Date(entry.slots[0].starts_at) : null;
  const lastHour = entry.slots[entry.slots.length - 1];
  const endedMsAgo = lastHour
    ? Date.now() - (new Date(lastHour.starts_at).getTime() + HOUR_MS)
    : Number.POSITIVE_INFINITY;

  // Clicks keep accruing from the permanent page and what #1 costs moves on every
  // sale, so the card is never truly static -- it just settles down.
  const cacheControl =
    endedMsAgo > HOUR_MS
      ? "public, s-maxage=86400, stale-while-revalidate=604800"
      : "public, s-maxage=60, stale-while-revalidate=300";

  try {
    return new ImageResponse(
      <ReceiptCard
        entry={entry}
        numberOneCents={numberOnePrice(topAmount)}
        upcoming={Boolean(firstHour && firstHour.getTime() > Date.now())}
      />,
      {
        ...CARD_SIZE,
        headers: { "cache-control": cacheControl },
      },
    );
  } catch (err) {
    // A render failure must not reach X's crawler as a 500; it would cache the error.
    console.error(`card render failed for ${slug}`, err);
    return new Response("Card unavailable", { status: 404 });
  }
}
