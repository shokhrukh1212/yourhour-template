import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnnouncement } from "../x";

const base = {
  displayName: "Screenwar",
  pitch: "A single 1920x1080 screen that never scrolls. Buy a ticker.",
  slotId: "21797",
  postNumber: 4,
  xHandle: "@ZKYXYKZ",
  pricePaid: 470,
  nextPrice: 452,
};

test("numbers the post by the order it airs, zero padded to three digits", () => {
  assert.match(buildAnnouncement(base), /^⚡ YOURHOUR #004\n/);
  assert.match(buildAnnouncement({ ...base, postNumber: 12 }), /^⚡ YOURHOUR #012\n/);
  assert.match(buildAnnouncement({ ...base, postNumber: 1234 }), /^⚡ YOURHOUR #1234\n/);
});

test("a single hour reads as one hour", () => {
  const text = buildAnnouncement(base);
  assert.match(text, /This hour belongs to @ZKYXYKZ\./);
  assert.match(text, /on our homepage for the next 60 minutes\./);
});

/**
 * A block of consecutive hours is ONE sale, so it gets ONE post describing the whole
 * run -- not the same product reposted once an hour.
 */
test("a block of consecutive hours reads as the whole run", () => {
  const text = buildAnnouncement({ ...base, blockHours: 3 });
  assert.match(text, /The next 3 hours belong to @ZKYXYKZ\./);
  assert.match(text, /on our homepage for the next 3 hours\./);
  assert.doesNotMatch(text, /This hour belongs to/);
  assert.doesNotMatch(text, /60 minutes/);
});

test("blockHours of 1, 0 or missing all read as a single hour", () => {
  for (const blockHours of [undefined, 1, 0, -3]) {
    assert.match(buildAnnouncement({ ...base, blockHours }), /This hour belongs to/);
  }
});

test("the price is what the post covers, and names the next OPEN hour", () => {
  assert.match(
    buildAnnouncement(base),
    /They paid \$4\.70\. The next open hour costs \$4\.52\./,
  );
});

test("a gifted hour credits both accounts", () => {
  const text = buildAnnouncement({ ...base, gifterHandle: "@shahzod1001" });
  assert.match(text, /This hour belongs to @ZKYXYKZ — gifted by @shahzod1001\./);
});

test("a gifted block credits both accounts and still names the run", () => {
  const text = buildAnnouncement({ ...base, blockHours: 3, gifterHandle: "@shahzod1001" });
  assert.match(text, /The next 3 hours belong to @ZKYXYKZ — gifted by @shahzod1001\./);
});

test("falls back to the product name when the buyer gave no handle", () => {
  assert.match(
    buildAnnouncement({ ...base, xHandle: null }),
    /This hour belongs to Screenwar\./,
  );
});

test("quotes only the first sentence of the pitch, and omits it when there is none", () => {
  assert.match(buildAnnouncement(base), /“A single 1920x1080 screen that never scrolls\.”/);
  assert.doesNotMatch(buildAnnouncement({ ...base, pitch: null }), /“/);
});

test("omits the price line entirely when nothing was paid", () => {
  const text = buildAnnouncement({ ...base, pricePaid: null });
  assert.doesNotMatch(text, /They paid/);
  assert.match(text, /Live now →/, "the rest of the post still renders");
});

test("always links through the counted redirect for the hour that is live", () => {
  assert.match(buildAnnouncement(base), /\/r\/21797$/m);
});
