import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  initiateCheckoutEvent,
  markMetaEventSent,
  PLACEMENT_CONTENT_NAME,
  purchaseEvent,
  resetMetaEventMemory,
} from "../meta-pixel";

/** A localStorage stand-in. `persist` survives a "refresh"; the page memory does not. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const CATALOG_KEYS = ["contents", "content_ids", "content_type", "num_items", "quantity"];

test("a created checkout session reports exactly one InitiateCheckout in USD", () => {
  const event = initiateCheckoutEvent(
    { checkoutUrl: "https://pay.example/checkout", intentId: "intent-1", amountDueCents: 900 },
    800,
  );
  assert.ok(event);
  assert.equal(event.name, "InitiateCheckout");
  assert.equal(event.params.value, 9);
  assert.equal(typeof event.params.value, "number");
  assert.equal(event.params.currency, "USD");
  assert.equal(event.eventId, "intent-1");
});

test("the server's price wins over the amount the browser had selected", () => {
  const event = initiateCheckoutEvent({ checkoutUrl: "/pay", amountDueCents: 300 }, 5000);
  assert.equal(event?.params.value, 3);
});

test("a checkout that was never created reports nothing", () => {
  assert.equal(initiateCheckoutEvent({ error: "BID_TOO_LOW" } as never, 900), null);
  assert.equal(initiateCheckoutEvent(null, 900), null);
  assert.equal(initiateCheckoutEvent(undefined, 900), null);
  assert.equal(initiateCheckoutEvent({ checkoutUrl: "" }, 900), null);
  assert.equal(initiateCheckoutEvent({ checkoutUrl: "/pay" }, 0), null);
});

test("a verified payment reports one Purchase with the amount actually charged", () => {
  const event = purchaseEvent(
    { ready: true, status: "completed", orderId: "ls-order-42", amountPaidCents: 1200 },
    "intent-1",
  );
  assert.ok(event);
  assert.equal(event.name, "Purchase");
  assert.deepEqual(event.params, { value: 12, currency: "USD", content_name: PLACEMENT_CONTENT_NAME });
  assert.equal(event.eventId, "ls-order-42");
});

test("Purchase carries no catalog parameters, because this account runs no catalog ads", () => {
  const purchase = purchaseEvent({ ready: true, orderId: "o-1", amountPaidCents: 500 });
  const started = initiateCheckoutEvent({ checkoutUrl: "/pay", intentId: "i-1", amountDueCents: 500 }, 500);
  for (const key of CATALOG_KEYS) {
    assert.ok(!(key in (purchase?.params ?? {})), `Purchase must not send ${key}`);
    assert.ok(!(key in (started?.params ?? {})), `InitiateCheckout must not send ${key}`);
  }
});

test("an unpaid, expired or still-pending checkout reports no Purchase", () => {
  assert.equal(purchaseEvent({ ready: false, status: "pending" }), null);
  assert.equal(purchaseEvent({ ready: false, status: "expired" }), null);
  assert.equal(purchaseEvent({ status: "completed", amountPaidCents: 900 }), null);
  assert.equal(purchaseEvent(null), null);
});

test("a payment the backend has not verified an amount for reports no Purchase", () => {
  // What a hand-typed /?purchase=<uuid> produces before any webhook has landed.
  assert.equal(purchaseEvent({ ready: true, status: "completed", orderId: "o-1", amountPaidCents: null }), null);
  assert.equal(purchaseEvent({ ready: true, orderId: "o-1", amountPaidCents: 0 }), null);
  assert.equal(purchaseEvent({ ready: true, orderId: "o-1", amountPaidCents: Number.NaN }), null);
  // ready without any id to key the event on cannot be deduplicated, so it is not sent.
  assert.equal(purchaseEvent({ ready: true, amountPaidCents: 900 }), null);
});

test("the event id falls back to the checkout intent when no order id came back", () => {
  const event = purchaseEvent({ ready: true, orderId: null, amountPaidCents: 900 }, "intent-9");
  assert.equal(event?.eventId, "intent-9");
});

test("one confirmed payment is reported once, however often the poller answers", () => {
  resetMetaEventMemory();
  const storage = fakeStorage();
  const key = "Purchase:ls-order-42";
  assert.equal(markMetaEventSent(key, storage), true);
  assert.equal(markMetaEventSent(key, storage), false);
  assert.equal(markMetaEventSent(key, storage), false);
});

test("refreshing the confirmation page cannot recount a purchase", () => {
  resetMetaEventMemory();
  const storage = fakeStorage();
  const key = "Purchase:ls-order-42";
  assert.equal(markMetaEventSent(key, storage), true);
  resetMetaEventMemory(); // a fresh document, same browser
  assert.equal(markMetaEventSent(key, storage), false);
  // A different order is still its own conversion.
  assert.equal(markMetaEventSent("Purchase:ls-order-43", storage), true);
});

test("a browser that refuses storage still reports one purchase per page load", () => {
  resetMetaEventMemory();
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
  };
  assert.equal(markMetaEventSent("Purchase:o-7", blocked), true);
  assert.equal(markMetaEventSent("Purchase:o-7", blocked), false);
});

test("the Meta tag is initialised once and never alongside a second PageView", () => {
  const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.equal(layout.match(/fbq\('init'/g)?.length, 1);
  assert.equal(layout.match(/fbq\('track','PageView'\)/g)?.length, 1);
  assert.match(layout, /config\.metaPixel\.id/);
  assert.doesNotMatch(layout, /fbq\('init','\d/); // the id comes from the environment
});

test("the existing X pixel and Vemetric analytics are still installed", () => {
  const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /twq\('config','\$\{config\.xPixel\.id\}'\)/);
  assert.match(layout, /<VemetricScript token=\{vemetricToken\} \/>/);
});
