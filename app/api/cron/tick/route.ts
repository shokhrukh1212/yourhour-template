import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { reconcileBoard } from "@/lib/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Keeps the calendar honest when nobody is looking. reconcileBoard() also runs on every
 * page render, so on a busy day this endpoint does nothing -- it exists because a day
 * with no visitors would otherwise leave finished hours showing as live and the 24-hour
 * calendar unpopulated.
 *
 * Driven by any external HTTP pinger; hourly is plenty. Idempotent, so a double fire or
 * a missed tick are both harmless.
 */
async function handle(request: Request) {
  if (!config.cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }

  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("secret");

  if (provided !== config.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const reconciled = await reconcileBoard();

  return NextResponse.json(
    { ok: true, ms: Date.now() - started, reconciled },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
