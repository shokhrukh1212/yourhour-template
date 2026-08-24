import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/lemonsqueezy";
import { applyPaidOrder } from "@/lib/sale";

export const dynamic = "force-dynamic";

type LemonWebhook = {
  meta?: {
    event_name?: string;
    custom_data?: { intent_id?: string; mode?: string };
  };
  data?: {
    id?: string;
    attributes?: {
      total?: number;
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
  if (eventName !== "order_created") {
    // Acknowledge anything else so Lemon Squeezy stops retrying it.
    return NextResponse.json({ ignored: eventName });
  }

  const orderId = payload.data?.id;
  if (!orderId) {
    return NextResponse.json({ error: "missing order id" }, { status: 400 });
  }

  const status = payload.data?.attributes?.status;
  if (status && status !== "paid") {
    return NextResponse.json({ ignored: `order status ${status}` });
  }

  try {
    const outcome = await applyPaidOrder({
      orderId: String(orderId),
      intentId: payload.meta?.custom_data?.intent_id ?? null,
      providerTotalCents: payload.data?.attributes?.total ?? 0,
    });
    return NextResponse.json(outcome);
  } catch (err) {
    console.error("failed to apply paid order", err);
    // 500 so Lemon Squeezy retries; applyPaidOrder is idempotent on order id.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}
