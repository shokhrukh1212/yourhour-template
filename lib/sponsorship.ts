import "server-only";

import type { PoolClient } from "pg";
import { query, withTransaction } from "./db";
import { readSponsorPricing } from "./sponsorship-pricing";
import {
  SPONSOR_DURATIONS,
  SPONSOR_POSITIONS,
  type SponsorCampaign,
  type SponsorDuration,
  type SponsorPosition,
  type SponsorSlot,
} from "./sponsorship-shared";

export const SPONSOR_LOCK_NAMESPACE = 8_140_25_02;

type SponsorRow = {
  id: string;
  position: number;
  product_url: string;
  product_name: string;
  product_description: string | null;
  logo_url: string | null;
  duration_days: number;
  amount_paid_cents: number;
  currency: string;
  click_count: number;
  status: string;
  reservation_expires_at: Date;
  starts_at: Date | null;
  ends_at: Date | null;
};

function publicCampaign(row: SponsorRow): SponsorCampaign {
  return {
    id: row.id,
    position: row.position as SponsorPosition,
    productUrl: row.product_url,
    productName: row.product_name,
    description: row.product_description,
    logoUrl: row.logo_url,
    durationDays: row.duration_days as SponsorDuration,
    amountPaidCents: row.amount_paid_cents,
    currency: row.currency,
    clickCount: row.click_count,
    startsAt: row.starts_at!.toISOString(),
    endsAt: row.ends_at!.toISOString(),
  };
}

export async function lockSponsorPosition(client: PoolClient, position: SponsorPosition): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [SPONSOR_LOCK_NAMESPACE, position]);
}

export async function expireSponsorships(client: PoolClient, position: SponsorPosition | null = null): Promise<void> {
  await client.query(
    `UPDATE sponsorships
        SET status = CASE WHEN status = 'active' THEN 'expired' ELSE 'cancelled' END,
            updated_at = now()
      WHERE ((status = 'pending' AND reservation_expires_at <= now())
         OR (status = 'active' AND ends_at <= now()))
        AND ($1::smallint IS NULL OR position = $1)`,
    [position],
  );
}

export async function getSponsorSlots(): Promise<SponsorSlot[]> {
  let rows: SponsorRow[];
  try {
    rows = await withTransaction(async (client) => {
      await expireSponsorships(client);
      const result = await client.query<SponsorRow>(
        `SELECT id::text, position, product_url, product_name, product_description,
                logo_url, duration_days, amount_paid_cents, currency, click_count,
                status, reservation_expires_at, starts_at, ends_at
           FROM sponsorships
          WHERE (status = 'active' AND starts_at <= now() AND ends_at > now())
             OR (status = 'pending' AND reservation_expires_at > now())
          ORDER BY position ASC`,
      );
      return result.rows;
    });
  } catch (error) {
    // Keep the existing homepage usable during a migration-first deployment window.
    // Checkout still fails closed until the table exists.
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code !== "42P01") throw error;
    rows = [];
  }
  const active = new Map(rows.filter((row) => row.status === "active").map((row) => [row.position, publicCampaign(row)]));
  const pending = new Map(rows.filter((row) => row.status === "pending").map((row) => [row.position, row.reservation_expires_at.toISOString()]));
  const pricing = readSponsorPricing();

  return SPONSOR_POSITIONS.map((position) => ({
    position,
    prices: Object.fromEntries(SPONSOR_DURATIONS.map((duration) => [
      duration,
      pricing.ok ? pricing.value.prices[position][duration] : null,
    ])) as Record<SponsorDuration, number | null>,
    currency: pricing.ok ? pricing.value.currency : null,
    active: active.get(position) ?? null,
    reservedUntil: pending.get(position) ?? null,
  }));
}

export async function expireAllSponsorships(): Promise<number> {
  const before = await query<{ count: string }>(
    `SELECT count(*)::text AS count FROM sponsorships
      WHERE (status = 'pending' AND reservation_expires_at <= now())
         OR (status = 'active' AND ends_at <= now())`,
  );
  await withTransaction(expireSponsorships);
  return Number(before[0]?.count ?? 0);
}
