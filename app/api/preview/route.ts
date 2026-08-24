import { NextResponse } from "next/server";
import { fetchUrlMetadata } from "@/lib/metadata";
import { checkProductUrl } from "@/lib/validate";
import { findWallEntryByUrl, wallNameIsTaken } from "@/lib/wall";

export const dynamic = "force-dynamic";

/**
 * What the claim panel's spinner waits on: the product name and pitch pulled from the
 * buyer's own page, before any money is involved.
 *
 * Advisory only. /api/checkout runs the same validation again under the board lock,
 * because two buyers racing on the same name must not both get through.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const check = checkProductUrl(String(raw.url ?? ""));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const meta = await fetchUrlMetadata(check.normalized);
  const existing = await findWallEntryByUrl(check.normalized);

  // Only worth blocking on a name we actually read. A hostname guess colliding is not
  // the buyer's fault, and they get editable fields to fix it.
  if (!existing && meta.scraped && (await wallNameIsTaken(meta.productName))) {
    return NextResponse.json(
      { error: "Someone is already on the Wall as that product." },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      url: check.normalized,
      productName: meta.productName,
      pitch: meta.pitch,
      imageUrl: meta.imageUrl,
      scraped: meta.scraped,
      existing,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
