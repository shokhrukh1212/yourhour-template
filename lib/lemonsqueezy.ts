import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const API = "https://api.lemonsqueezy.com/v1";

export type CheckoutMode = "bid";

export type CheckoutInput = {
  priceCents: number;
  intentId: string;
  expiresAt: Date;
  productName: string;
  mode: CheckoutMode;
};

function headers() {
  return {
    Accept: "application/vnd.api+json",
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${config.lemonSqueezy.apiKey}`,
  };
}

export async function createCheckout(input: CheckoutInput): Promise<string> {
  const { storeId, variantId } = config.lemonSqueezy;
  const successUrl = `${config.siteUrl}/?purchase=${input.intentId}`;
  const description = `${input.productName} · permanent leaderboard bid`;

  const res = await fetch(`${API}/checkouts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          custom_price: input.priceCents,
          expires_at: input.expiresAt.toISOString(),
          checkout_data: {
            custom: {
              intent_id: input.intentId,
              mode: input.mode,
              // Lemon Squeezy requires every checkout_data.custom value to be a string.
              expected_amount_cents: String(input.priceCents),
            },
          },
          product_options: {
            name: `YourHour leaderboard bid`,
            description,
            redirect_url: successUrl,
            receipt_button_text: "See the leaderboard",
            receipt_link_url: successUrl,
            receipt_thank_you_note: "Your product stays permanently on the leaderboard. Completed bids are final.",
            enabled_variants: [Number(variantId)],
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
  return received.length === expected.length && timingSafeEqual(expected, received);
}
