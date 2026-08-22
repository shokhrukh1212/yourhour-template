import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SILENT_HOURS_BEFORE_DECAY,
  applyDecay,
  applySale,
  BLOCK_OPTIONS,
  LAST_MINUTE_CENTS,
  LAST_MINUTE_WINDOW_MS,
  blockMinimum,
  effectiveFloor,
  formatPrice,
  hourFloor,
  hourPrice,
  isLastMinute,
  roundToCent,
  splitAmount,
  standingMinimum,
} from "../pricing";

/**
 * Fixed instants, chosen for their US Eastern hour rather than their UTC one -- that is
 * what the tier is derived from. August is EDT (UTC-4).
 *   13:00 UTC -> 09:00 ET, prime
 *   23:00 UTC -> 19:00 ET, normal
 *   07:00 UTC -> 03:00 ET, dead
 */
const PRIME = new Date("2026-08-22T13:00:00Z");
const NORMAL = new Date("2026-08-22T23:00:00Z");
const DEAD = new Date("2026-08-22T07:00:00Z");

/** The board as reconcile.ts walks it: a price and the high that sets its floor. */
function silence(price: number, allTimeHigh: number, hours: number) {
  let silent = 0;
  for (let i = 0; i < hours; i++) {
    silent++;
    if (silent > SILENT_HOURS_BEFORE_DECAY) {
      price = applyDecay(price, allTimeHigh);
      silent = 0;
    }
  }
  return price;
}

test("walks the $1 board through sales and silence", () => {
  let p = 100;
  p = applySale(p, p);
  assert.equal(p, 120, "sale -> $1.20");
  // Three quiet hours are free. The mechanic only bites once silence persists.
  assert.equal(silence(p, p, 3), 120, "three silent hours -> unchanged");
  assert.equal(silence(p, p, 4), 114, "the fourth silent hour -> $1.14");
  // The drop restarts the grace period, so the fifth, sixth and seventh are free again.
  assert.equal(silence(p, p, 7), 114, "hours five through seven -> unchanged");
  assert.equal(silence(p, p, 8), 108, "the eighth -> $1.08");
});

test("a sale resets the silent run, so decay has to start over", () => {
  const p = 500;
  // Three quiet hours, a sale, then three more quiet hours: still no decay at all.
  let price = silence(p, p, 3);
  price = applySale(price, price);
  assert.equal(silence(price, price, 3), 600, "the run restarts from zero");
});

test("the ratchet stops P at half its all-time high, however long the silence runs", () => {
  const high = 4000;
  let p = high;
  for (let i = 0; i < 500; i++) p = applyDecay(p, high);
  assert.equal(p, 2000, "$40 board never sells an hour under $20 again");
});

test("the config floor still applies below the first ratchet", () => {
  // A board that has only ever been at $1 has an all-time high of $1, and half of that
  // is under the hard floor -- so the hard floor is what holds.
  assert.equal(effectiveFloor(100), 100);
  let p = 150;
  for (let i = 0; i < 200; i++) p = applyDecay(p, 150);
  assert.equal(p, 100);
});

test("has no ceiling", () => {
  let p = 100;
  let high = p;
  for (let i = 0; i < 40; i++) {
    p = applySale(p, high);
    high = Math.max(high, p);
  }
  assert.ok(p > 100_000, `expected P to climb past $1000, got ${p}`);
});

test("a sale always moves the price off the floor", () => {
  // The whole-dollar rounding this replaced froze P at $1 forever: round(120/100)*100 = 100.
  assert.equal(applySale(100, 100), 120);
});

test("rounds to the nearest cent, not toward zero", () => {
  assert.equal(roundToCent(112.5), 113);
  assert.equal(roundToCent(101.7), 102);
  // $2.50 x 0.95 = $2.375 -> $2.38.
  assert.equal(applyDecay(250, 250), 238);
});

test("the six-hour block is gone; only one and three are offered", () => {
  assert.deepEqual(
    BLOCK_OPTIONS.map((b) => b.hours),
    [1, 3],
  );
});

test("scales the floor by the hour's time-of-day tier", () => {
  assert.equal(hourFloor(200, PRIME), 400, "prime is 2x");
  assert.equal(hourFloor(200, NORMAL), 200, "normal is the floor itself");
  assert.equal(hourFloor(500, DEAD), 200, "dead is 0.4x");
});

test("no hour is ever priced below $1, whatever the tier says", () => {
  assert.equal(hourFloor(100, DEAD), 100, "$1 x 0.4 would be $0.40");
  assert.equal(hourFloor(200, DEAD), 100, "$2 x 0.4 = $0.80 -> $1");
  // The clamp is the flat global minimum, NOT the ratcheted floor: a board that has
  // been up at $40 still sells a dead hour cheaply.
  assert.equal(hourFloor(1000, DEAD), 400);
});

test("an unsold hour inside the last half hour clears at a flat $1", () => {
  const at = new Date("2026-08-22T13:00:00Z"); // prime, so its real price is 2x
  const soon = new Date("2026-08-22T12:45:00Z"); // 15 minutes before it
  const early = new Date("2026-08-22T12:10:00Z"); // 50 minutes before it

  assert.equal(isLastMinute(at, soon), true);
  assert.equal(isLastMinute(at, early), false);
  assert.equal(hourPrice(200, at, soon), LAST_MINUTE_CENTS, "clears, tier ignored");
  assert.equal(hourPrice(200, at, early), 400, "still far enough out to cost prime rates");

  // The hour already in progress is past its start, so it always clears.
  const live = new Date("2026-08-22T12:00:00Z");
  assert.equal(isLastMinute(live, soon), true);
});

test("the window is exactly 30 minutes, and closed at its far edge", () => {
  assert.equal(LAST_MINUTE_WINDOW_MS, 30 * 60 * 1000);

  const at = new Date("2026-08-22T13:00:00Z");
  assert.equal(isLastMinute(at, new Date("2026-08-22T12:30:00Z")), false, "30 min is not yet");
  assert.equal(isLastMinute(at, new Date("2026-08-22T12:30:01Z")), true, "a second later, yes");
});

/**
 * The reason the window is half an hour and not a full one. Slots begin on the hour, so
 * at 60 minutes the NEXT hour would always be inside the window and nobody would ever
 * have a reason to pay its real price -- they could simply wait it out.
 */
test("the next hour holds its real price for the first half of the current hour", () => {
  const next = new Date("2026-08-22T13:00:00Z"); // prime
  const justAfterTheHour = new Date("2026-08-22T12:00:30Z");
  const halfwayThrough = new Date("2026-08-22T12:31:00Z");

  assert.equal(hourPrice(200, next, justAfterTheHour), 400, "full price early in the hour");
  assert.equal(hourPrice(200, next, halfwayThrough), 100, "clearance only in the last half");
});

test("prices a block off the anchor hour's tier, cheaper per hour than one at a time", () => {
  assert.equal(blockMinimum(200, NORMAL, 1), 200);
  assert.equal(blockMinimum(200, NORMAL, 3), 500, "3 hours at $2 -> $5, not $6");
  assert.equal(blockMinimum(200, PRIME, 3), 1000, "prime doubles the base first");
  assert.equal(blockMinimum(500, DEAD, 3), 500, "dead: $5 x 0.4 = $2, then x2.5");
  // An unknown block size must never silently discount; it falls back to one hour.
  assert.equal(blockMinimum(200, NORMAL, 4), 200);
});

test("clearance never leaks into a block or a standing hour", () => {
  const now = new Date("2026-08-22T12:45:00Z");
  const soon = new Date("2026-08-22T13:00:00Z"); // clearance territory, and prime

  assert.equal(hourPrice(200, soon, now), 100, "one hour on its own clears");
  assert.equal(blockMinimum(200, soon, 3), 1000, "three hours do not");
  assert.equal(standingMinimum(200, soon, 3), 1000, "a standing run does not either");
});

test("prices a standing hour off that hour's floor, 2.5x for 3 days and 5x for 7", () => {
  assert.equal(standingMinimum(200, NORMAL, 3), 500);
  assert.equal(standingMinimum(200, NORMAL, 7), 1000);
  assert.equal(standingMinimum(200, PRIME, 3), 1000, "prime doubles the base first");
  assert.equal(standingMinimum(200, PRIME, 7), 2000);
  assert.equal(standingMinimum(500, DEAD, 7), 1000, "dead: $5 x 0.4 = $2, then x5");
  // An unknown length must never silently discount.
  assert.equal(standingMinimum(200, NORMAL, 5), 200);
});

test("splits a block's payment so the shares add back up exactly", () => {
  assert.deepEqual(splitAmount(1000, 1), [1000]);
  assert.deepEqual(splitAmount(1000, 3), [334, 333, 333]);
  assert.deepEqual(splitAmount(500, 6), [84, 84, 83, 83, 83, 83]);
  for (const [total, parts] of [[1, 6], [7, 3], [99_999, 6]] as const) {
    const shares = splitAmount(total, parts);
    assert.equal(shares.length, parts);
    assert.equal(shares.reduce((a, b) => a + b, 0), total, `${total}/${parts}`);
  }
});

test("shows cents only when there are cents", () => {
  assert.equal(formatPrice(100), "$1");
  assert.equal(formatPrice(2100), "$21");
  assert.equal(formatPrice(125), "$1.25");
  assert.equal(formatPrice(113), "$1.13");
  assert.equal(formatPrice(110), "$1.10");
  assert.equal(formatPrice(100_000), "$1,000");
  assert.equal(formatPrice(123_456), "$1,234.56");
});
