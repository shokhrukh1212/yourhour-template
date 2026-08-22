import { NextResponse } from "next/server";
import { getNextOpenSlot } from "@/lib/slots";
import { reconcileBoard } from "@/lib/reconcile";

export const dynamic = "force-dynamic";

/** Development helper for scripts/test-e2e.sh. Not available in production. */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  await reconcileBoard();
  const slot = await getNextOpenSlot();
  if (!slot) return NextResponse.json({ error: "no open slot" }, { status: 404 });
  return NextResponse.json({ id: slot.id, startsAt: slot.starts_at });
}
