import { config } from "./config";

type XConversionInput = {
  /** Lemon Squeezy order id. Doubles as the dedup key for retried webhooks. */
  orderId: string;
  amountPaidCents: number;
  eventSourceUrl: string;
  twclid: string | null;
};

/**
 * Server-side purchase conversion for the X Ads Conversions API. Complements the
 * browser pixel in RootLayout, which only sees page views.
 *
 * Skipped without a twclid: the API requires at least one identifier per conversion,
 * and this app never collects the alternatives (hashed email/phone, raw IP -- see
 * lib/click.ts) for buyers, so organic sales simply have nothing to attribute.
 * Always fire-and-forget: ad tracking must never break a paid flow.
 */
export async function trackXConversion(input: XConversionInput): Promise<"sent" | "skipped" | "failed"> {
  const { id: pixelId, accessToken, purchaseEventId } = config.xPixel;
  if (!pixelId || !accessToken || !input.twclid) return "skipped";

  try {
    const res = await fetch(`https://ads-api.x.com/12/measurement/conversions/${pixelId}`, {
      method: "POST",
      headers: {
        "X-Pixel-Token": accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversions: [
          {
            conversion_time: new Date().toISOString(),
            ...(purchaseEventId ? { event_id: purchaseEventId } : {}),
            conversion_id: input.orderId,
            event_source_url: input.eventSourceUrl,
            identifiers: [{ twclid: input.twclid }],
            value: (input.amountPaidCents / 100).toFixed(2),
            currency: "USD",
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("x conversion failed", res.status, await res.text());
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("x conversion failed", err);
    return "failed";
  }
}
