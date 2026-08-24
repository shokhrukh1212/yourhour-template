import assert from "node:assert/strict";
import test from "node:test";
import { validateClaim } from "../validate";

function claim(hours: unknown) {
  return validateClaim({ url: "https://example.com/product", amount: "7", hours });
}

test("accepts every supported consecutive homepage duration", () => {
  for (const hours of [1, 2, 3, 6]) {
    const result = claim(hours);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.hours, hours);
  }
});

test("rejects unsupported homepage durations", () => {
  for (const hours of [0, 4, 5, 7, "2.5", "six"]) {
    const result = claim(hours);
    assert.deepEqual(result, { ok: false, error: "Choose 1, 2, 3, or 6 homepage hours." });
  }
});
