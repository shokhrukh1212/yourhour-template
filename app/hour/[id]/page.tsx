import { notFound, permanentRedirect } from "next/navigation";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * The old numeric permalink. Links posted before /u/{slug} existed still point here, so
 * it redirects rather than 404s -- /u/{slug} is the page and owns the card now.
 */
export default async function HourPage({ params }: Params) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  // The slug lives on the purchase, not the hour.
  const rows = await query<{ slug: string | null }>(
    `SELECT e.slug FROM slots s JOIN wall_entries e ON e.id = s.wall_entry_id
      WHERE s.id = $1`,
    [id],
  );
  const slug = rows[0]?.slug;
  if (!slug) notFound();

  permanentRedirect(`/u/${slug}`);
}
