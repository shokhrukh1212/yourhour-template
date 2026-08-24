import assert from "node:assert/strict";
import test from "node:test";
import {
  bonusClickLimit,
  guaranteedClicksDelivered,
  isCampaignComplete,
} from "../delivery";

test("the final delivered click completes a campaign immediately", () => {
  assert.equal(isCampaignComplete(50, 49), false);
  assert.equal(isCampaignComplete(50, 50), true);
});

test("previously refunded inventory does not get delivered twice after a top-up", () => {
  assert.equal(isCampaignComplete(70, 59, 10), false);
  assert.equal(isCampaignComplete(70, 60, 10), true);
});

test("bonus clicks never satisfy the paid delivery guarantee", () => {
  assert.equal(guaranteedClicksDelivered(59, 10), 49);
  assert.equal(isCampaignComplete(50, 59, 0, 10), false);
  assert.equal(isCampaignComplete(50, 60, 0, 10), true);
});

test("a bonus round is capped at half the original purchase", () => {
  assert.equal(bonusClickLimit(50), 25);
  assert.equal(bonusClickLimit(25), 12);
  assert.equal(bonusClickLimit(1), 0);
});
