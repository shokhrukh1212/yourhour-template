import assert from "node:assert/strict";
import { test } from "node:test";
import { rankForAmount, rankLabel } from "../wall-rank";

const WALL = [10_000, 5000, 5000, 2500, 500];

test("ranks an amount against the Wall", () => {
  assert.equal(rankForAmount(WALL, 20_000), 1, "beats everyone");
  assert.equal(rankForAmount(WALL, 7500), 2, "between the top two");
  assert.equal(rankForAmount(WALL, 100), 6, "below everyone");
});

test("a tie ranks below the entry it ties with, because that buyer paid first", () => {
  // Two entries already sit at $50. Matching them lands you third of the three.
  assert.equal(rankForAmount(WALL, 5000), 4);
  assert.equal(rankForAmount(WALL, 5001), 2, "one cent more takes the position");
});

test("an empty Wall makes any amount rank first", () => {
  assert.equal(rankForAmount([], 500), 1);
});

test("past the sampled list the rank is honest about being approximate", () => {
  const sample = [300, 200, 100];
  assert.equal(rankLabel(sample, 50, true), "#3+", "capped: we only know it is below");
  assert.equal(rankLabel(sample, 50, false), "#4", "uncapped: the list is the whole Wall");
  assert.equal(rankLabel(sample, 250, true), "#2", "inside the sample is exact either way");
});
