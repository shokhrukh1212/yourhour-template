import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const API = "https://api.lemonsqueezy.com/v1";

export type CheckoutMode = "purchase" | "jump";

export type CheckoutInput = {
  priceCents: number;
  intentId: string;
  expiresAt: Date;
  productName: string;
  mode: CheckoutMode;
  clicks?: number;
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
  const successUrl = `${config.siteUrl}/success?r=${input.intentId}`;
  const description =
    input.mode === "purchase"
      ? `${input.productName} · ${input.clicks ?? 0} guaranteed clicks`
      : `${input.productName} · queue jump`;

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
              click_quantity: String(input.clicks ?? 0),
              expected_amount_cents: String(input.priceCents),
            },
          },
          product_options: {
            name: `Guaranteed clicks from ${config.siteName}`,
            description,
            redirect_url: successUrl,
            receipt_button_text: "See your campaign",
            receipt_link_url: successUrl,
            receipt_thank_you_note:
              "Your product stays in the queue until every purchased click is delivered or refunded.",
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

type OrderResponse = {
  data?: { attributes?: { refunded_amount?: number } };
};

export async function getRefundedAmount(orderId: string): Promise<number> {
  const res = await fetch(`${API}/orders/${encodeURIComponent(orderId)}`, { headers: headers() });
  if (!res.ok) throw new Error(`Could not read Lemon Squeezy order ${orderId} (${res.status})`);
  const json = (await res.json()) as OrderResponse;
  return json.data?.attributes?.refunded_amount ?? 0;
}

export async function issueRefund(orderId: string, amountCents: number): Promise<number> {
  const res = await fetch(`${API}/orders/${encodeURIComponent(orderId)}/refund`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: {
        type: "orders",
        id: String(orderId),
        attributes: { amount: amountCents },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lemon Squeezy refund failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as OrderResponse;
  return json.data?.attributes?.refunded_amount ?? amountCents;
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
