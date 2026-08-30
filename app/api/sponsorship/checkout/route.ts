import { NextResponse } from "next/server";
import { config, isLemonSqueezyConfigured } from "@/lib/config";
import { withTransaction } from "@/lib/db";
import { createSponsorshipCheckout } from "@/lib/lemonsqueezy";
import { fetchUrlMetadata } from "@/lib/metadata";
import { sponsorPrice } from "@/lib/sponsorship-pricing";
import { expireSponsorships, lockSponsorPosition } from "@/lib/sponsorship";
import { sanitizeSponsorshipMetadata, validateSponsorshipCheckout } from "@/lib/validate";

export const dynamic = "force-dynamic";

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.");
  }
  const parsed = validateSponsorshipCheckout(body);
  if (!parsed.ok) return fail(parsed.error);

  let authoritativePrice: { amountCents: number; currency: string };
  try {
    authoritativePrice = sponsorPrice(parsed.value.position, parsed.value.durationDays);
  } catch {
    return fail("Sponsorship pricing is temporarily unavailable.", 503);
  }

  const metadata = await fetchUrlMetadata(parsed.value.url);
  const { productName, description } = sanitizeSponsorshipMetadata(metadata.productName, metadata.pitch);
  if (!productName) return fail("Could not determine a product name from that URL.");
  const reservationExpiresAt = new Date(
    Date.now() + config.sponsorReservationMinutes * 60_000,
  );

  let sponsorshipId: string;
  try {
    sponsorshipId = await withTransaction(async (client) => {
      await lockSponsorPosition(client, parsed.value.position);
      await expireSponsorships(client, parsed.value.position);
      const occupied = await client.query(
        `SELECT 1 FROM sponsorships
          WHERE position = $1 AND status IN ('pending','active') LIMIT 1 FOR UPDATE`,
        [parsed.value.position],
      );
      if (occupied.rows[0]) throw new Error("POSITION_TAKEN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sponsorships
           (position, product_url, product_name, product_description, logo_url,
            duration_days, amount_paid_cents, currency, status, reservation_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9)
         RETURNING id::text`,
        [
          parsed.value.position,
          parsed.value.url,
          productName,
          description,
          metadata.imageUrl,
          parsed.value.durationDays,
          authoritativePrice.amountCents,
          authoritativePrice.currency,
          reservationExpiresAt,
        ],
      );
      return inserted.rows[0].id;
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const pgCode = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    if (code === "POSITION_TAKEN" || pgCode === "23505") {
      return fail("This position was just taken. Choose another available position.", 409);
    }
    console.error("sponsorship reservation failed", error);
    return fail("Could not reserve this sponsorship position. Try again.", 500);
  }

  let checkoutUrl: string;
  let checkoutSessionId: string;
  try {
    if (!isLemonSqueezyConfigured()) {
      if (process.env.NODE_ENV === "production") throw new Error("PAYMENTS_NOT_CONFIGURED");
      checkoutSessionId = `dev-${sponsorshipId}`;
      checkoutUrl = `/api/dev/sponsorship-complete?id=${encodeURIComponent(sponsorshipId)}`;
    } else {
      const checkout = await createSponsorshipCheckout({
        priceCents: authoritativePrice.amountCents,
        intentId: sponsorshipId,
        expiresAt: reservationExpiresAt,
        productName,
      });
      checkoutUrl = checkout.url;
      checkoutSessionId = checkout.checkoutId;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE sponsorships
            SET checkout_session_id = $2, checkout_url = $3, updated_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [sponsorshipId, checkoutSessionId, checkoutUrl],
      );
    });
  } catch (error) {
    console.error("sponsorship checkout failed", error);
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE sponsorships SET status = 'cancelled', updated_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [sponsorshipId],
      );
    });
    return fail(
      error instanceof Error && error.message === "PAYMENTS_NOT_CONFIGURED"
        ? "Payments are not configured."
        : "Could not start checkout. Try again.",
      503,
    );
  }

  return NextResponse.json({
    checkoutUrl,
    sponsorshipId,
    amountCents: authoritativePrice.amountCents,
    currency: authoritativePrice.currency,
    durationDays: parsed.value.durationDays,
    position: parsed.value.position,
  });
}
