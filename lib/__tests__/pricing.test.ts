import assert from "node:assert/strict";
import test from "node:test";
import { amountDueCents, isWholeDollarBid, nextBidCents, normalizeDollarInput, normalizeLegacyBidCents, settledBidCents } from "../pricing";

test("the empty board starts at $3 and every next bid adds one dollar", () => {
  assert.equal(nextBidCents(null), 300);
  assert.equal(nextBidCents(300), 400);
  assert.equal(nextBidCents(1700), 1800);
});

test("legacy totals round up to whole dollars without rewriting them to the new-entry floor", () => {
  assert.equal(normalizeLegacyBidCents(156), 200);
  assert.equal(normalizeLegacyBidCents(470), 500);
  assert.equal(normalizeLegacyBidCents(500), 500);
  assert.equal(normalizeLegacyBidCents(501), 600);
});

test("owners pay only the difference while new listings pay the full target", () => {
  assert.equal(amountDueCents(null, 700), 700);
  assert.equal(amountDueCents(500, 700), 200);
});

test("a delayed payment keeps every paid dollar after a checkout race", () => {
  assert.equal(settledBidCents(500,700,200),700);
  assert.equal(settledBidCents(800,700,200),1000);
});

test("bids are bounded whole-dollar totals", () => {
  assert.equal(isWholeDollarBid(300), true);
  assert.equal(isWholeDollarBid(350), false);
  assert.equal(isWholeDollarBid(200), false);
});

test("editable dollar values never retain a leading zero", () => {
  assert.equal(normalizeDollarInput(""), "");
  assert.equal(normalizeDollarInput("04"), "4");
  assert.equal(normalizeDollarInput("00012"), "12");
  assert.equal(normalizeDollarInput("4.5"), null);
});
