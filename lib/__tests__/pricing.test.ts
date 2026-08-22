import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_WALL_TOP_CENTS,
  MIN_ENTRY_CENTS,
  OUTBID_STEP_CENTS,
  formatPrice,
  numberOnePrice,
} from "../pricing";
import { rankForAmount } from "../wall-rank";

test("an empty Wall quotes the opening price for #1", () => {
  assert.equal(numberOnePrice(null), EMPTY_WALL_TOP_CENTS);
  assert.equal(numberOnePrice(0), EMPTY_WALL_TOP_CENTS);
});

test("#1 costs a dollar more than the top of the Wall", () => {
  assert.equal(numberOnePrice(470), 570);
  assert.equal(numberOnePrice(100), 200);
  assert.equal(numberOnePrice(12_345), 12_445);
});

test("the price only ever rises, and only when somebody pays", () => {
  // Walk a Wall forward: each buyer takes #1, and the next #1 is strictly dearer.
  let top: number | null = null;
  let previous = 0;
  for (let i = 0; i < 50; i += 1) {
    const price = numberOnePrice(top);
    assert.ok(price > previous, `price fell at step ${i}: ${previous} -> ${price}`);
    previous = price;
    top = price;
  }
  // Nothing in the module can lower it: there is no input that makes it fall.
  assert.equal(numberOnePrice(previous), previous + OUTBID_STEP_CENTS);
});

test("the minimum entry is a hardcoded $3", () => {
  assert.equal(MIN_ENTRY_CENTS, 300);
});

test("paying the quoted #1 price actually takes rank #1", () => {
  const wall = [470, 158, 156];
  const price = numberOnePrice(wall[0]);
  assert.equal(rankForAmount(wall, price), 1);
  // Matching the top exactly is not enough -- ties go to whoever paid first.
  assert.equal(rankForAmount(wall, wall[0]), 2);
});

test("paying less than #1 takes the rank that amount earns", () => {
  const wall = [470, 158, 156];
  assert.equal(rankForAmount(wall, 300), 2);
  assert.equal(rankForAmount(wall, 157), 3);
  assert.equal(rankForAmount(wall, MIN_ENTRY_CENTS), 2);
});

test("formatPrice drops empty cents and keeps real ones", () => {
  assert.equal(formatPrice(500), "$5");
  assert.equal(formatPrice(570), "$5.70");
  assert.equal(formatPrice(300), "$3");
  assert.equal(formatPrice(1_234_56), "$1,234.56");
});
