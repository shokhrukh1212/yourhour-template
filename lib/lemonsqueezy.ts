import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const API = "https://api.lemonsqueezy.com/v1";

export type CheckoutInput = {
  priceCents: number;
  /** The hour this purchase was assigned. */
  slotId: string;
  reservationId: string;
  expiresAt: Date;
  productName: string;
};

/**
 * custom_price overrides the product's list price per checkout, which is how one Lemon
 * Squeezy variant sells a Wall rank at whatever amount the buyer chose. Nothing needs
 * setting up in the Lemon Squeezy dashboard beyond the one variant that already exists.
 *
 * No email is collected here -- Lemon Squeezy is Merchant of Record, asks for it at
 * checkout, and sends the receipt itself.
 */
export async function createCheckout(input: CheckoutInput): Promise<string> {
  const { apiKey, storeId, variantId } = config.lemonSqueezy;

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
            custom: {
              slot_id: input.slotId,
              reservation_id: input.reservationId,
            },
          },
          product_options: {
            name: `A permanent spot on The Wall at ${config.siteName}`,
            description: input.productName,
            // The buyer's slug is only decided inside the sale transaction, so the
            // redirect carries the reservation id instead and /success waits for the
            // webhook if it has not landed yet.
            redirect_url: `${config.siteUrl}/success?r=${input.reservationId}`,
            receipt_button_text: "See your spot",
            receipt_thank_you_note:
              "You're on The Wall. It's permanent -- nobody is ever removed.",
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
