import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_WALL_TOP_CENTS,
  MIN_ENTRY_CENTS,
  formatPrice,
  numberOnePrice,
  priceToOvertake,
  roundUpToWholeDollar,
} from "../pricing";
import { rankForAmount } from "../wall-rank";

test("an empty Wall quotes the opening price for #1", () => {
  assert.equal(numberOnePrice(null), EMPTY_WALL_TOP_CENTS);
  assert.equal(numberOnePrice(0), EMPTY_WALL_TOP_CENTS);
});

test("#1 costs one dollar more, rounded up to a whole dollar", () => {
  assert.equal(numberOnePrice(470), 600);
  assert.equal(numberOnePrice(100), 300);
  assert.equal(numberOnePrice(12_345), 12_500);
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
  assert.equal(numberOnePrice(previous), priceToOvertake(previous));
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

test("prices and displayed amounts round up to whole dollars", () => {
  assert.equal(formatPrice(500), "$5");
  assert.equal(formatPrice(470), "$5");
  assert.equal(formatPrice(570), "$6");
  assert.equal(formatPrice(300), "$3");
  assert.equal(formatPrice(1_234_56), "$1,235");
  assert.equal(roundUpToWholeDollar(101), 200);
});

test("each Wall entry has a whole-dollar price to take its rank", () => {
  assert.equal(priceToOvertake(200), 300);
  assert.equal(priceToOvertake(470), 600);
  assert.equal(priceToOvertake(1000), 1100);
  assert.equal(priceToOvertake(1), MIN_ENTRY_CENTS);
});

test("a button is only labelled with a rank its quoted price can actually take", () => {
  // A $3 bid clears the tied $2 entries, so it is an honest action for #2 only.
  const wall = [500, 200, 200, 200];
  const price = priceToOvertake(wall[1]);
  assert.equal(price, 300);
  assert.equal(rankForAmount(wall, price), 2);
  assert.notEqual(rankForAmount(wall, price), 3);
  assert.notEqual(rankForAmount(wall, price), 4);
});
