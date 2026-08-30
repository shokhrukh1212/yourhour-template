import { NextResponse } from "next/server";
import { fetchUrlMetadata } from "@/lib/metadata";
import { checkProductUrl } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const checked = checkProductUrl(String(raw?.url ?? ""));
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const metadata = await fetchUrlMetadata(checked.normalized);
  return NextResponse.json(
    {
      url: checked.normalized,
      productName: metadata.productName,
      description: metadata.pitch,
      logoUrl: metadata.imageUrl,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
