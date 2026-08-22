import { NextResponse } from "next/server";
import { numberOnePrice } from "@/lib/pricing";
import { getWallEntryBySlug, getWallTopAmount } from "@/lib/wall";

export const dynamic = "force-dynamic";

/** What the permanent page polls: the two numbers on it that keep moving. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const [entry, topAmount] = await Promise.all([getWallEntryBySlug(slug), getWallTopAmount()]);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(
    { clicks: entry.total_clicks, numberOne: numberOnePrice(topAmount) },
    { headers: { "cache-control": "no-store" } },
  );
}
