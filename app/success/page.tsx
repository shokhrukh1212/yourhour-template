import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { formatPrice } from "@/lib/pricing";
import { SuccessActions, WaitingForPayment } from "./SuccessActions";
import { LocalTime } from "@/components/LocalTime";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata = { title: "You're on the Wall" };

type Row = {
  status: string;
  amount: number | null;
  display_name: string | null;
  slug: string | null;
  starts_at: Date | null;
  amount_paid: number | null;
  entry_id: string | null;
  created_at: Date | null;
};

/**
 * Where a buyer lands after paying. This replaced the confirmation email, so it has to
 * carry everything that email did: what they got, when their hour is, and the link to
 * the page that is now theirs.
 *
 * The slug is only decided inside the sale transaction, so Lemon Squeezy sends people
 * here with the reservation id instead. If the webhook has not landed yet the page shows
 * what it already knows and polls until it has, rather than 404ing for a second or two.
 */
export default async function Success({
  searchParams,
}: {
  searchParams: Promise<{ r?: string }>;
}) {
  const reservationId = (await searchParams).r ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(reservationId)) notFound();

  const rows = await query<Row>(
    `SELECT r.status, r.amount, r.display_name,
            e.slug, e.amount_paid, e.id::text AS entry_id, e.created_at,
            s.starts_at
       FROM reservations r
       LEFT JOIN wall_entries e ON e.id = r.wall_entry_id
       LEFT JOIN slots s ON s.id = r.slot_id
      WHERE r.id = $1`,
    [reservationId],
  );
  const row = rows[0];
  if (!row) notFound();

  const name = row.display_name ?? "Your product";

  if (!row.slug || !row.entry_id) {
    return (
      <Shell>
        <WaitingForPayment reservationId={reservationId} name={name} />
      </Shell>
    );
  }

  // Same ordering the Wall itself uses, so the rank shown here is the rank they occupy.
  const rankRows = await query<{ ahead: string }>(
    `SELECT count(*)::text AS ahead FROM wall_entries
      WHERE amount_paid > $1
         OR (amount_paid = $1 AND (created_at, id) < ($2::timestamptz, $3::bigint))`,
    [row.amount_paid, row.created_at, row.entry_id],
  );
  const rank = Number(rankRows[0]?.ahead ?? 0) + 1;
  const paid = row.amount_paid ?? row.amount ?? 0;
  const pageUrl = `${config.siteUrl.replace(/^https?:\/\//, "")}/u/${row.slug}`;

  return (
    <Shell>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        You&apos;re on the Wall.
      </h1>

      <p className="mt-6 text-lg">
        <span className="font-semibold tabular text-accent">#{rank}</span>
        <span className="mx-2 text-faint">·</span>
        <span className="font-semibold tabular">{formatPrice(paid)}</span>
        <span className="mx-2 text-faint">·</span>
        <span className="text-muted">permanent</span>
      </p>

      {row.starts_at ? (
        <p className="mt-6 text-base text-muted">
          Your hour on the homepage:{" "}
          <span className="font-medium text-foreground">
            <LocalTime iso={new Date(row.starts_at).toISOString()} mode="when" />
          </span>
        </p>
      ) : null}

      <p className="mt-2 text-base text-muted">
        Your page:{" "}
        <Link href={`/u/${row.slug}`} className="font-medium text-accent hover:underline">
          {pageUrl}
        </Link>
      </p>

      <SuccessActions
        slug={row.slug}
        rank={rank}
        siteUrl={config.siteUrl}
        startsAtIso={row.starts_at ? new Date(row.starts_at).toISOString() : null}
      />

      <p className="mt-10 text-xs leading-relaxed text-faint">
        This page, its click count and its place on the Wall stay up for as long as this
        site exists. Nobody is ever removed.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">
          ← yourhour
        </Link>
        <div className="mt-10">{children}</div>
      </div>
    </main>
  );
}
