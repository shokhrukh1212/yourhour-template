import assert from "node:assert/strict";
import test from "node:test";
import { paidOrderValidationError } from "../sale";
import { createCheckout, createSponsorshipCheckout } from "../lemonsqueezy";

test("verified payment fields must agree with the server price", () => {
  assert.equal(paidOrderValidationError(500, { providerSubtotalCents: 500, providerTotalCents: 500, providerCurrency: "USD" }), null);
  assert.equal(paidOrderValidationError(1000, { providerSubtotalCents: 1000, providerTotalCents: 1000, providerCurrency: "USD" }), null);
  assert.equal(paidOrderValidationError(1000, { providerSubtotalCents: 999, providerTotalCents: 999, providerCurrency: "USD" }), "PAYMENT_AMOUNT_MISMATCH");
  assert.equal(paidOrderValidationError(1000, { providerSubtotalCents: 1100, providerTotalCents: 1100, providerCurrency: "USD" }), "PAYMENT_AMOUNT_MISMATCH");
  assert.equal(paidOrderValidationError(1000, { providerSubtotalCents: 1000, providerTotalCents: 900, providerCurrency: "USD" }), "PAYMENT_TOO_SMALL");
  assert.equal(paidOrderValidationError(1000, { providerSubtotalCents: 1000, providerTotalCents: 1000, providerCurrency: "EUR" }), "INVALID_CURRENCY");
});

test("sponsorship checkout carries server intent and provider checkout ID", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      data: { id: "checkout-42", attributes: { url: "https://checkout.example.test/sponsor" } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const checkout = await createSponsorshipCheckout({
      priceCents: 2500,
      intentId: "sponsor-intent-1",
      expiresAt: new Date("2026-08-31T00:00:00.000Z"),
      productName: "Example",
    });
    const parsed = JSON.parse(requestBody) as {
      data: { attributes: { checkout_data: { custom: Record<string, unknown> } } };
    };
    assert.equal(checkout.checkoutId, "checkout-42");
    assert.equal(parsed.data.attributes.checkout_data.custom.mode, "sponsorship");
    assert.equal(parsed.data.attributes.checkout_data.custom.intent_id, "sponsor-intent-1");
    assert.equal(parsed.data.attributes.checkout_data.custom.expected_amount_cents, "2500");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Lemon Squeezy checkout custom metadata uses strings", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ data: { attributes: { url: "https://checkout.example.test/1" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await createCheckout({
      priceCents: 500,
      intentId: "intent-1",
      expiresAt: new Date("2026-08-31T00:00:00.000Z"),
      productName: "Example",
      mode: "bid",
    });
    const parsed = JSON.parse(requestBody) as {
      data: { attributes: { checkout_data: { custom: Record<string, unknown> } } };
    };
    const custom = parsed.data.attributes.checkout_data.custom;
    assert.equal(custom.expected_amount_cents, "500");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
