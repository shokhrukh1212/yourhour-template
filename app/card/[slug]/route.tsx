import { ImageResponse } from "next/og";
import { CARD_SIZE, ReceiptCard } from "@/components/card/ReceiptCard";
import { getCampaignBySlug } from "@/lib/campaigns";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug.replace(/\.png$/, "");
  const entry = await getCampaignBySlug(slug);
  if (!entry) return new Response("Not found", { status: 404 });
  try {
    return new ImageResponse(<ReceiptCard entry={entry} />, { ...CARD_SIZE, headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (error) {
    console.error(`card render failed for ${slug}`, error);
    return new Response("Card unavailable", { status: 404 });
  }
}
