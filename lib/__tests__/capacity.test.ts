import assert from "node:assert/strict";
import test from "node:test";
import { canReservePurchase, effectiveOutstandingCap } from "../capacity";

test("capacity always admits the largest advertised package when the queue is empty", () => {
  assert.equal(effectiveOutstandingCap(150), 250);
  assert.equal(canReservePurchase(150, 0, 0, 250), true);
});

test("outstanding campaigns and unpaid holds still consume capacity", () => {
  assert.equal(canReservePurchase(250, 50, 0, 200), true);
  assert.equal(canReservePurchase(250, 51, 0, 200), false);
  assert.equal(canReservePurchase(250, 0, 25, 250), false);
});
