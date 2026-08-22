/**
 * Time-of-day pricing. An hour is worth what the clock says it is worth: the middle of
 * the US working day is prime, the evening is ordinary, and the small hours are dead.
 *
 * Everything here is pure and dependency-free so the claim form can price a calendar
 * row on the client without a round trip, and so the server can price the same row
 * identically.
 */

export type PeakTier = "prime" | "normal" | "dead";

/** The tier boundaries, in US Eastern hours. */
const PRIME_FROM = 9;
const PRIME_UNTIL = 17; // exclusive: 09:00-16:59
const NORMAL_UNTIL = 24; // exclusive: 17:00-23:59

export const PEAK_MULTIPLIERS: Record<PeakTier, number> = {
  prime: 2,
  normal: 1,
  dead: 0.4,
};

/** Only two of the three tiers are worth calling out; "normal" is the unmarked case. */
export const PEAK_TAGS: Record<PeakTier, string | null> = {
  prime: "prime",
  normal: null,
  dead: "quiet",
};

/**
 * The hour of the day in US Eastern. Derived from the named zone rather than a fixed
 * offset, so daylight saving is handled by ICU and not by us -- the same UTC instant
 * lands on a different Eastern hour either side of a transition, which is the point.
 */
export function easternHour(at: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(at);
  // Some ICU builds render midnight as "24" under h23. Fold it back to 0.
  return Number(formatted) % 24;
}

export function peakTier(at: Date): PeakTier {
  const hour = easternHour(at);
  if (hour >= PRIME_FROM && hour < PRIME_UNTIL) return "prime";
  if (hour >= PRIME_UNTIL && hour < NORMAL_UNTIL) return "normal";
  return "dead";
}

export function peakMultiplier(at: Date): number {
  return PEAK_MULTIPLIERS[peakTier(at)];
}

/** "prime" / "quiet", or null for an ordinary hour that needs no label. */
export function peakTag(at: Date): string | null {
  return PEAK_TAGS[peakTier(at)];
}
