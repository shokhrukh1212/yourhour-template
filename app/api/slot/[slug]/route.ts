import { NextResponse } from "next/server";
import { getBoard } from "@/lib/slots";
import { getWallEntryBySlug } from "@/lib/wall";

export const dynamic = "force-dynamic";

/** What the permanent page polls: the two numbers on it that keep moving. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const [entry, board] = await Promise.all([getWallEntryBySlug(slug), getBoard()]);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json(
    { clicks: entry.total_clicks, boardPrice: board.price },
    { headers: { "cache-control": "no-store" } },
  );
}
