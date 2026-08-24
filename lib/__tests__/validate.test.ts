import assert from "node:assert/strict";
import test from "node:test";
import { validateCheckout } from "../validate";

test("accepts package and custom click purchases", () => {
  for (const clicks of [25, 30, 50, 100, 200, 250]) {
    const result = validateCheckout({ mode: "purchase", url: "https://example.com/product", clicks });
    assert.equal(result.ok, true);
    if (result.ok && result.value.mode === "purchase") assert.equal(result.value.clicks, clicks);
  }
});

test("enforces whole click purchase boundaries", () => {
  assert.deepEqual(validateCheckout({ mode: "purchase", url: "https://example.com", clicks: 24 }), { ok: false, error: "Minimum 25 clicks." });
  assert.deepEqual(validateCheckout({ mode: "purchase", url: "https://example.com", clicks: 251 }), { ok: false, error: "Maximum 250 clicks per order." });
  assert.deepEqual(validateCheckout({ mode: "purchase", url: "https://example.com", clicks: "20.5" }), { ok: false, error: "Enter a whole number of clicks." });
});

test("accepts a bare product domain and normalizes its protocol", () => {
  assert.deepEqual(
    validateCheckout({ mode: "purchase", url: "something.com", clicks: 100 }),
    {
      ok: true,
      value: {
        mode: "purchase",
        url: "https://something.com/",
        clicks: 100,
        name: null,
        pitch: null,
        twclid: null,
      },
    },
  );
});

test("validates queue jumps and rejects retired purchase modes", () => {
  assert.deepEqual(validateCheckout({ mode: "jump", campaignId: "42" }), { ok: true, value: { mode: "jump", campaignId: "42" } });
  assert.deepEqual(validateCheckout({ mode: "rank_boost", campaignId: "42", targetAmountCents: 900 }), { ok: false, error: "Invalid purchase mode." });
});
