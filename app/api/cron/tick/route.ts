import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runCampaignMaintenance } from "@/lib/delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Expires abandoned bids and retries durable analytics delivery. Safe to retry. */
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
  const reconciled = await runCampaignMaintenance();

  return NextResponse.json(
    { ok: true, ms: Date.now() - started, reconciled },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = handle;
export const POST = handle;
