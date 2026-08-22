import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const API = "https://api.lemonsqueezy.com/v1";

export type CheckoutInput = {
  kind: "hour" | "wall";
  priceCents: number;
  email: string;
  /** Null for a Wall spot, which consumes no hour. */
  slotId: string | null;
  reservationId: string;
  expiresAt: Date;
  productName: string;
  /** Hours in the block; 0 for a Wall spot. */
  blockHours: number;
  /** Days a standing hour covers; 0 when the purchase is not a standing hour. */
  standingDays: number;
};

/**
 * custom_price overrides the product's list price per checkout, which is how one Lemon
 * Squeezy variant sells two different products at any amount the buyer chooses: an hour
 * (or a block of them) at or above the board's moving floor, and a permanent Wall spot.
 *
 * The two are told apart by `kind` in the checkout metadata, which comes back on the
 * webhook -- not by the variant, so neither product needs anything set up in the
 * Lemon Squeezy dashboard beyond the one that already exists.
 */
export async function createCheckout(input: CheckoutInput): Promise<string> {
  const { apiKey, storeId, variantId } = config.lemonSqueezy;
  const isWall = input.kind === "wall";
  const hours = input.blockHours;
  const days = input.standingDays;
  const name = isWall
    ? `A permanent spot on The Wall`
    : days > 0
      ? `The same hour for ${days} days on ${config.siteName}`
      : hours > 1
        ? `${hours} hours on ${config.siteName}`
        : `One hour on ${config.siteName}`;

  const res = await fetch(`${API}/checkouts`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          custom_price: input.priceCents,
          expires_at: input.expiresAt.toISOString(),
          checkout_data: {
            email: input.email,
            custom: {
              kind: input.kind,
              slot_id: input.slotId ?? "",
              reservation_id: input.reservationId,
            },
          },
          product_options: {
            name,
            description: input.productName,
            // A Wall entry has no page until the webhook lands and assigns its slug,
            // so send those buyers to the Wall itself rather than a URL that 404s.
            redirect_url: isWall
              ? `${config.siteUrl}/#wall`
              : `${config.siteUrl}/hour/${input.slotId}?welcome=1`,
            receipt_button_text: isWall ? "See The Wall" : "See your hour",
            receipt_thank_you_note: isWall
              ? "You're on The Wall. It's permanent -- it never resets."
              : days > 0
                ? `That hour is yours for ${days} days. We'll email you 30 minutes before each one starts.`
                : hours > 1
                  ? "Your hours are locked in. We'll email you 30 minutes before each one starts."
                  : "Your hour is locked in. We'll email you 30 minutes before it starts.",
          },
        },
        relationships: {
          store: { data: { type: "stores", id: String(storeId) } },
          variant: { data: { type: "variants", id: String(variantId) } },
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${body.slice(0, 400)}`);
  }

  const json = (await res.json()) as { data?: { attributes?: { url?: string } } };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy returned no checkout URL");
  return url;
}

/**
 * X-Signature is an HMAC-SHA256 of the RAW request body. It must be computed on the
 * exact bytes received -- parsing and re-serialising the JSON first will never match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = config.lemonSqueezy.webhookSecret;
  if (!secret || !signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (received.length !== expected.length) return false;
  return timingSafeEqual(expected, received);
}
