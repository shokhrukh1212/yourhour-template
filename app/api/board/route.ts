import { NextResponse } from "next/server";
import { getBoard, getLiveSlot } from "@/lib/slots";
import { getBuyerTotalClicks } from "@/lib/wall";

export const dynamic = "force-dynamic";

/** Small JSON payload the live hour polls for its click counter. */
export async function GET() {
  const [board, live] = await Promise.all([getBoard(), getLiveSlot()]);
  // Must be the same rollup the server-rendered hero started from, or the first poll
  // would jump the counter to a different number.
  const clicks = live ? await getBuyerTotalClicks(live.id) : 0;
  return NextResponse.json(
    {
      price: board.price,
      live: live ? { id: live.id, clicks, status: live.status } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
