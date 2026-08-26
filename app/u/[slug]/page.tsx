import { notFound, redirect } from "next/navigation";
import { getListingBySlug } from "@/lib/leaderboard";
export const dynamic = "force-dynamic";
export default async function LegacyProductRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const listing = await getListingBySlug((await params).slug);
  if (!listing) notFound();
  redirect(`/r/${listing.id}`);
}
