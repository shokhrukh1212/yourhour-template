import assert from "node:assert/strict";
import test from "node:test";
import { projectedRankForBid } from "../rank";

test("a bid beats lower totals but sits after earlier equal bids", () => {
  const bids = [600,500,500,300];
  assert.equal(projectedRankForBid(bids,700),1);
  assert.equal(projectedRankForBid(bids,600),2);
  assert.equal(projectedRankForBid(bids,500),4);
  assert.equal(projectedRankForBid(bids,400),4);
});

test("the first completed bid is rank one", () => {
  assert.equal(projectedRankForBid([],300),1);
});
