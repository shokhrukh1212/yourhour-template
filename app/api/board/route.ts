import { NextResponse } from "next/server";
import { numberOnePrice } from "@/lib/pricing";
import { getLiveSlot } from "@/lib/slots";
import { getBuyerTotalClicks, getWallTopAmount } from "@/lib/wall";

export const dynamic = "force-dynamic";

/** Small JSON payload the live hour polls for its click counter. */
export async function GET() {
  const [topAmount, live] = await Promise.all([getWallTopAmount(), getLiveSlot()]);
  // The hero prints the clicks THIS HOUR has earned, so poll the same number the server
  // rendered rather than the buyer's lifetime rollup.
  const clicks = live ? live.clicks : 0;
  const totalClicks = live ? await getBuyerTotalClicks(live.id) : 0;
  return NextResponse.json(
    {
      numberOne: numberOnePrice(topAmount),
      live: live ? { id: live.id, clicks, totalClicks, status: live.status } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
