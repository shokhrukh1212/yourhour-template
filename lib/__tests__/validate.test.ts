import assert from "node:assert/strict";
import test from "node:test";
import { checkProductUrl, validateBidCheckout } from "../validate";

test("accepts domains with or without an https scheme", () => {
  assert.deepEqual(checkProductUrl("name.com"), {
    ok: true,
    normalized: "https://name.com/",
  });
  assert.deepEqual(checkProductUrl("https://name.com"), {
    ok: true,
    normalized: "https://name.com/",
  });
});

test("accepts a normalized public URL and whole-dollar bid", () => {
  const result = validateBidCheckout({ url: "example.com/product", targetBidCents: 700, name: " Example ", pitch: " A product " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.url, "https://example.com/product");
    assert.equal(result.value.targetBidCents, 700);
    assert.equal(result.value.name, "Example");
  }
});

test("rejects fractional-dollar, low, and private bids", () => {
  assert.equal(validateBidCheckout({ url: "example.com", targetBidCents: 350 }).ok, false);
  assert.equal(validateBidCheckout({ url: "example.com", targetBidCents: 200 }).ok, false);
  assert.equal(validateBidCheckout({ url: "http://localhost", targetBidCents: 300 }).ok, false);
});
