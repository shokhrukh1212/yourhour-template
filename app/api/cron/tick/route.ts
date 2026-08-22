import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { reconcileBoard } from "@/lib/reconcile";
import { runDueSideEffects } from "@/lib/side-effects";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The catch-up worker. Driven by any HTTP pinger on a short interval; it is idempotent,
 * so a missed tick simply heals on the next one. Auth is a plain bearer secret, which
 * keeps the endpoint agnostic about who calls it (cron-job.org, QStash, Vercel cron).
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
  const effects = await runDueSideEffects();

  return NextResponse.json(
    { ok: true, ms: Date.now() - started, reconciled, effects },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
