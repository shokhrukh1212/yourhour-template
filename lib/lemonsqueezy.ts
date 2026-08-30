import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";

const API = "https://api.lemonsqueezy.com/v1";

export type CheckoutMode = "bid" | "sponsorship";

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

type CreatedCheckout = { url: string; checkoutId: string | null };

async function requestCheckout(input: CheckoutInput): Promise<CreatedCheckout> {
  const { storeId, variantId } = config.lemonSqueezy;
  const sponsorship = input.mode === "sponsorship";
  const successUrl = sponsorship
    ? `${config.siteUrl}/?sponsorship=${input.intentId}`
    : `${config.siteUrl}/?purchase=${input.intentId}`;
  const description = sponsorship
    ? `${input.productName} · temporary sponsored placement`
    : `${input.productName} · permanent leaderboard bid`;

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
            name: sponsorship ? "YourHour sponsorship" : "YourHour leaderboard bid",
            description,
            redirect_url: successUrl,
            receipt_button_text: sponsorship ? "See your sponsorship" : "See the leaderboard",
            receipt_link_url: successUrl,
            receipt_thank_you_note: sponsorship
              ? "Your placement starts after payment is verified. Sponsorship does not affect leaderboard rank."
              : "Your product stays permanently on the leaderboard. Completed bids are final.",
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
  const json = (await res.json()) as { data?: { id?: string; attributes?: { url?: string } } };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy returned no checkout URL");
  return { url, checkoutId: json.data?.id ? String(json.data.id) : null };
}

export async function createCheckout(input: CheckoutInput): Promise<string> {
  return (await requestCheckout(input)).url;
}

export async function createSponsorshipCheckout(
  input: Omit<CheckoutInput, "mode">,
): Promise<{ url: string; checkoutId: string }> {
  const created = await requestCheckout({ ...input, mode: "sponsorship" });
  if (!created.checkoutId) throw new Error("Lemon Squeezy returned no checkout ID");
  return { url: created.url, checkoutId: created.checkoutId };
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
