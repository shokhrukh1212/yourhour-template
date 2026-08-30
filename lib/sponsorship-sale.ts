import type { PoolClient } from "pg";
import { withTransaction } from "./db";
import { expireSponsorships, lockSponsorPosition } from "./sponsorship";
import type { SponsorPosition } from "./sponsorship-shared";
import { sponsorshipPaymentValidationError } from "./sponsorship-payment";

export type PaidSponsorshipInput = {
  sponsorshipId: string | null;
  orderId: string;
  providerSubtotalCents: number;
  providerTotalCents: number;
  providerCurrency: string;
};

type PaidSponsorRow = {
  id: string;
  position: number;
  duration_days: number;
  amount_paid_cents: number;
  currency: string;
  status: string;
  provider_order_id: string | null;
};

export async function applyPaidSponsorshipOrder(
  input: PaidSponsorshipInput,
): Promise<{ status: "applied" | "duplicate"; sponsorshipId: string }> {
  return withTransaction(async (client) => {
    const duplicate = await client.query<{ id: string }>(
      `SELECT id::text FROM sponsorships WHERE provider_order_id = $1 LIMIT 1`,
      [input.orderId],
    );
    if (duplicate.rows[0]) {
      return { status: "duplicate" as const, sponsorshipId: duplicate.rows[0].id };
    }
    if (!input.sponsorshipId) throw new Error("MISSING_SPONSORSHIP");

    const initial = await client.query<Pick<PaidSponsorRow, "position">>(
      `SELECT position FROM sponsorships WHERE id = $1`,
      [input.sponsorshipId],
    );
    if (!initial.rows[0]) throw new Error("SPONSORSHIP_NOT_FOUND");
    await lockSponsorPosition(client, initial.rows[0].position as SponsorPosition);
    await expireSponsorships(client, initial.rows[0].position as SponsorPosition);

    const selected = await client.query<PaidSponsorRow>(
      `SELECT id::text, position, duration_days, amount_paid_cents, currency,
              status, provider_order_id
         FROM sponsorships WHERE id = $1 FOR UPDATE`,
      [input.sponsorshipId],
    );
    const sponsor = selected.rows[0];
    if (!sponsor) throw new Error("SPONSORSHIP_NOT_FOUND");

    if (sponsor.provider_order_id === input.orderId && sponsor.status === "active") {
      return { status: "duplicate" as const, sponsorshipId: sponsor.id };
    }
    if (!["pending", "cancelled"].includes(sponsor.status)) throw new Error("SPONSORSHIP_INVALID");
    const paymentError = sponsorshipPaymentValidationError(
      sponsor.amount_paid_cents,
      sponsor.currency,
      input,
    );
    if (paymentError) throw new Error(paymentError);

    const occupied = await client.query(
      `SELECT 1 FROM sponsorships
        WHERE position = $1 AND id <> $2 AND status IN ('pending','active') LIMIT 1 FOR UPDATE`,
      [sponsor.position, sponsor.id],
    );
    if (occupied.rows[0]) throw new Error("POSITION_TAKEN_AFTER_PAYMENT");

    const updated = await client.query<{ id: string }>(
      `UPDATE sponsorships
          SET status = 'active', provider_order_id = $2, starts_at = now(),
              ends_at = now() + make_interval(days => duration_days), updated_at = now()
        WHERE id = $1
        RETURNING id::text`,
      [sponsor.id, input.orderId],
    );
    return { status: "applied" as const, sponsorshipId: updated.rows[0].id };
  });
}

export async function disablePaidSponsorship(
  orderId: string,
  status: "cancelled" | "refunded",
): Promise<boolean> {
  return withTransaction(async (client: PoolClient) => {
    const updated = await client.query(
      `UPDATE sponsorships SET status = $2, updated_at = now()
        WHERE provider_order_id = $1 AND status IN ('pending','active')`,
      [orderId, status],
    );
    return (updated.rowCount ?? 0) > 0;
  });
}
