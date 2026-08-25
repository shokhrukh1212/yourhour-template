import assert from "node:assert/strict";
import test from "node:test";
import { CLICK_RATE_CENTS, CLICK_STEP, DEFAULT_CHECKOUT_CLICKS, DEFAULT_CLICKS, MAX_CLICKS, MIN_CLICKS, MIN_ENTRY_CENTS, clickPackageForInput, formatPrice, jumpPrice, priceForClicks } from "../pricing";

test("click inventory has one fixed rate and exact boundaries", () => {
  assert.equal(CLICK_RATE_CENTS, 20);
  assert.equal(MIN_CLICKS, 25);
  assert.equal(DEFAULT_CLICKS, 50);
  assert.equal(DEFAULT_CHECKOUT_CLICKS, 100);
  assert.equal(CLICK_STEP, 5);
  assert.equal(MAX_CLICKS, 250);
  assert.equal(MIN_ENTRY_CENTS, 500);
  assert.equal(priceForClicks(25), 500);
  assert.equal(priceForClicks(50), 1000);
  assert.equal(priceForClicks(250), 5000);
});

test("package highlighting always agrees with the exact input", () => {
  assert.equal(clickPackageForInput("50"), 50);
  assert.equal(clickPackageForInput("200"), 200);
  assert.equal(clickPackageForInput("250"), 250);
  assert.equal(clickPackageForInput("25"), null);
  assert.equal(clickPackageForInput(""), null);
  assert.equal(clickPackageForInput("50.0"), null);
});

test("money keeps meaningful cents and the minimum displays as $5", () => {
  assert.equal(formatPrice(500), "$5");
  assert.equal(formatPrice(1000), "$10");
  assert.equal(formatPrice(5000), "$50");
});

test("queue jumps start at $2 and rise one dollar above priority", () => {
  assert.equal(jumpPrice(0), 200);
  assert.equal(jumpPrice(200), 300);
  assert.equal(jumpPrice(650), 750);
});
