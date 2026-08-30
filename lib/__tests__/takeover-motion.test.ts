import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeVerifiedTakeover,
  hasReplayedTakeover,
  resetTakeoverReplayMemory,
  takeoverReplayKey,
  verifiedTakeoverFromStatus,
} from "../takeover-motion";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

const verifiedFirstPlace = {
  ready: true,
  status: "completed",
  orderId: "provider-order-42",
  listingId: "100",
  productName: "New leader",
  amountPaidCents: 1_200,
  bidCents: 1_000,
  rank: 1,
} as const;

test("a takeover is eligible only from the verified completed first-place result", () => {
  assert.deepEqual(verifiedTakeoverFromStatus(verifiedFirstPlace), {
    transactionId: "provider-order-42",
    listingId: "100",
    productName: "New leader",
    bidCents: 1_000,
  });
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, ready: false }), null);
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, status: "pending" }), null);
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, rank: 2 }), null);
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, orderId: null }), null);
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, listingId: null }), null);
  assert.equal(verifiedTakeoverFromStatus({ ...verifiedFirstPlace, amountPaidCents: 0 }), null);
  // A hand-written ?purchase= query contains none of these verified server fields.
  assert.equal(verifiedTakeoverFromStatus({}), null);
});

test("the animation is not consumed until the authoritative board confirms the same leader", () => {
  resetTakeoverReplayMemory();
  const storage = fakeStorage();
  assert.equal(consumeVerifiedTakeover(verifiedFirstPlace, "99", storage), null);
  assert.equal(storage.data[takeoverReplayKey("provider-order-42")], undefined);
  assert.ok(consumeVerifiedTakeover(verifiedFirstPlace, "100", storage));
});

test("a verified transaction plays at most once across rerenders, refreshes, and a reopened URL", () => {
  resetTakeoverReplayMemory();
  const storage = fakeStorage();
  assert.ok(consumeVerifiedTakeover(verifiedFirstPlace, "100", storage));
  assert.equal(consumeVerifiedTakeover(verifiedFirstPlace, "100", storage), null);
  resetTakeoverReplayMemory(); // a new document after refresh or browser back
  assert.equal(hasReplayedTakeover("provider-order-42", storage), true);
  assert.equal(consumeVerifiedTakeover(verifiedFirstPlace, "100", storage), null);
  assert.ok(consumeVerifiedTakeover({ ...verifiedFirstPlace, orderId: "provider-order-43" }, "100", storage));
});
