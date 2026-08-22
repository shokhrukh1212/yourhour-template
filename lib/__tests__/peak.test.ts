import assert from "node:assert/strict";
import { test } from "node:test";
import { easternHour, peakMultiplier, peakTag, peakTier } from "../peak";

/** August is EDT, UTC-4. Every instant below is chosen for its Eastern hour. */
const edt = (hour: number) => new Date(Date.UTC(2026, 7, 22, (hour + 4) % 24));

test("splits the day into prime, normal and dead at the specified boundaries", () => {
  assert.equal(peakTier(edt(8)), "dead", "08:59 ET is still dead");
  assert.equal(peakTier(edt(9)), "prime", "09:00 ET opens prime");
  assert.equal(peakTier(edt(16)), "prime", "16:59 ET is the last prime hour");
  assert.equal(peakTier(edt(17)), "normal", "17:00 ET drops to normal");
  assert.equal(peakTier(edt(23)), "normal", "23:59 ET is the last normal hour");
  assert.equal(peakTier(edt(0)), "dead", "midnight ET is dead");
});

test("multiplies the floor by 2x, 1x and 0.4x", () => {
  assert.equal(peakMultiplier(edt(12)), 2);
  assert.equal(peakMultiplier(edt(20)), 1);
  assert.equal(peakMultiplier(edt(4)), 0.4);
});

test("labels only the two tiers worth calling out", () => {
  assert.equal(peakTag(edt(12)), "prime");
  assert.equal(peakTag(edt(20)), null, "an ordinary hour needs no tag");
  assert.equal(peakTag(edt(4)), "quiet");
});

test("midnight Eastern reads as hour 0, never as hour 24", () => {
  assert.equal(easternHour(edt(0)), 0);
});

/**
 * The load-bearing assertion. If a fixed UTC offset ever creeps in to replace the named
 * zone, these two cases break: the SAME UTC clock time lands on a different Eastern
 * hour either side of a daylight saving transition, and can cross a tier boundary
 * because of it.
 */
test("follows daylight saving, because the tier comes from the zone and not an offset", () => {
  // 13:00 UTC: EST (UTC-5) in winter -> 08:00 ET, dead. EDT (UTC-4) in summer -> 09:00 ET, prime.
  const winter = new Date("2026-01-15T13:00:00Z");
  const summer = new Date("2026-07-15T13:00:00Z");
  assert.equal(easternHour(winter), 8);
  assert.equal(easternHour(summer), 9);
  assert.equal(peakTier(winter), "dead");
  assert.equal(peakTier(summer), "prime");

  // Either side of the spring-forward, 2026-03-08 at 07:00 UTC.
  assert.equal(easternHour(new Date("2026-03-07T13:00:00Z")), 8, "still EST");
  assert.equal(easternHour(new Date("2026-03-09T13:00:00Z")), 9, "now EDT");

  // Either side of the fall-back, 2026-11-01 at 06:00 UTC.
  assert.equal(easternHour(new Date("2026-10-31T13:00:00Z")), 9, "still EDT");
  assert.equal(easternHour(new Date("2026-11-02T13:00:00Z")), 8, "back to EST");
});
