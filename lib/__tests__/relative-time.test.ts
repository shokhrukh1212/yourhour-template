import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeTime, relativeTimeRefreshMs } from "../relative-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("a payment under a minute old reads as just now", () => {
  assert.equal(formatRelativeTime(0), "just now");
  assert.equal(formatRelativeTime(59 * 1_000), "just now");
});

test("minutes round down and stay minutes until the hour", () => {
  assert.equal(formatRelativeTime(MINUTE), "1 minute ago");
  assert.equal(formatRelativeTime(10 * MINUTE), "10 minutes ago");
  assert.equal(formatRelativeTime(59 * MINUTE + 59_000), "59 minutes ago");
});

test("hours round down: 65, 100 and 119 minutes are all one hour", () => {
  assert.equal(formatRelativeTime(65 * MINUTE), "1 hour ago");
  assert.equal(formatRelativeTime(100 * MINUTE), "1 hour ago");
  assert.equal(formatRelativeTime(119 * MINUTE), "1 hour ago");
  assert.equal(formatRelativeTime(120 * MINUTE), "2 hours ago");
});

test("days round down: one day holds until exactly two days", () => {
  assert.equal(formatRelativeTime(23 * HOUR + 59 * MINUTE), "23 hours ago");
  assert.equal(formatRelativeTime(DAY), "1 day ago");
  assert.equal(formatRelativeTime(2 * DAY - 1), "1 day ago");
  assert.equal(formatRelativeTime(2 * DAY), "2 days ago");
});

test("minute labels refresh every five minutes without missing the hour", () => {
  assert.equal(relativeTimeRefreshMs(10 * MINUTE), 5 * MINUTE);
  assert.equal(relativeTimeRefreshMs(58 * MINUTE), 2 * MINUTE);
});

test("hour and day labels refresh on their own boundary", () => {
  assert.equal(relativeTimeRefreshMs(HOUR + 20 * MINUTE), 40 * MINUTE);
  assert.equal(relativeTimeRefreshMs(3 * DAY + 6 * HOUR), 18 * HOUR);
});
