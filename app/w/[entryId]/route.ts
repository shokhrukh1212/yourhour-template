import { NextResponse } from "next/server";
import { config } from "@/lib/config";

/** Preserves previously shared Wall links after the campaign migration. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const { entryId } = await params;
  return NextResponse.redirect(new URL(`/r/${/^\d+$/.test(entryId) ? entryId : ""}`, config.siteUrl));
}
