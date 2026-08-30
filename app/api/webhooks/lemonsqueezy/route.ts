import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";
import { applyPaidOrder } from "@/lib/sale";
import { applyPaidSponsorshipOrder, disablePaidSponsorship } from "@/lib/sponsorship-sale";

export const dynamic = "force-dynamic";

type LemonWebhook = {
  meta?: {
    event_name?: string;
    custom_data?: { intent_id?: string; mode?: string };
  };
  data?: {
    id?: string;
    attributes?: {
      subtotal?: number;
      total?: number;
      currency?: string;
      test_mode?: boolean;
      status?: string;
    };
  };
};

export async function POST(request: Request) {
  // Must read the raw bytes: the signature is an HMAC over the exact body received.
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: LemonWebhook;
  try {
    payload = JSON.parse(rawBody) as LemonWebhook;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const eventName = payload.meta?.event_name ?? request.headers.get("x-event-name");
  const orderId = payload.data?.id;
  if (!orderId) {
    return NextResponse.json({ error: "missing order id" }, { status: 400 });
  }

  if (eventName === "order_refunded" || eventName === "order_cancelled") {
    const disabled = await disablePaidSponsorship(
      String(orderId),
      eventName === "order_refunded" ? "refunded" : "cancelled",
    );
    return NextResponse.json({ disabled, eventName });
  }

  if (eventName !== "order_created") {
    // Acknowledge anything else so Lemon Squeezy stops retrying it.
    return NextResponse.json({ ignored: eventName });
  }

  const status = payload.data?.attributes?.status;
  if (status && status !== "paid") {
    return NextResponse.json({ ignored: `order status ${status}` });
  }

  try {
    if (payload.meta?.custom_data?.mode === "sponsorship") {
      const outcome = await applyPaidSponsorshipOrder({
        orderId: String(orderId),
        sponsorshipId: payload.meta.custom_data.intent_id ?? null,
        providerSubtotalCents: payload.data?.attributes?.subtotal ?? 0,
        providerTotalCents: payload.data?.attributes?.total ?? 0,
        providerCurrency: payload.data?.attributes?.currency ?? "",
      });
      return NextResponse.json(outcome);
    }
    const outcome = await applyPaidOrder({
      orderId: String(orderId),
      intentId: payload.meta?.custom_data?.intent_id ?? null,
      providerSubtotalCents: payload.data?.attributes?.subtotal ?? 0,
      providerTotalCents: payload.data?.attributes?.total ?? 0,
      providerCurrency: payload.data?.attributes?.currency ?? "",
      providerTestMode: Boolean(payload.data?.attributes?.test_mode),
    });
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("failed to apply paid order", err);
    // 500 so Lemon Squeezy retries; applyPaidOrder is idempotent on order id.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
