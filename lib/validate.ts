import { MIN_ENTRY_CENTS } from "./pricing";
import { isHomepageHours, type HomepageHours } from "./slot-block";

/** Enough room for two readable Wall-card lines before the visual clamp. */
export const PITCH_MAX = 180;
export const DISPLAY_NAME_MAX = 60;

/** Nobody is paying this much, so anything above it is a typo or an attack. */
const AMOUNT_MAX_CENTS = 100_000_00;

/**
 * Social profiles are not products. Two of the first five Wall entries were somebody's
 * X profile, which is what "X (formerly Twitter)" scrapes to -- a link nobody clicks and
 * a name that says nothing about what was bought.
 */
const SOCIAL_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

export type ClaimInput = {
  /** The hour the buyer picked, or null to take the earliest open one. */
  slotId: string | null;
  /** Consecutive homepage hours to buy at the selected bid per hour. */
  hours: HomepageHours;
  /** What the buyer chose to pay, in cents. Their permanent rank on the Wall. */
  amountCents: number;
  url: string;
  /** Only used when the scrape fails and the buyer fills the fields in by hand. */
  name: string | null;
  pitch: string | null;
  /** X ad click id, present when checkout started from an ad click. */
  twclid: string | null;
};

export type ValidationResult =
  | { ok: true; value: ClaimInput }
  | { ok: false; error: string };

export type UrlCheck =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

/**
 * Blocks loopback and private ranges so a listing can't point at internal
 * infrastructure, and social profiles so the Wall stays a list of products.
 */
export function checkProductUrl(raw: string): UrlCheck {
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "Enter a valid public http(s) URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Enter a valid public http(s) URL." };
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    !host.includes(".")
  ) {
    return { ok: false, error: "Enter a valid public http(s) URL." };
  }

  if (SOCIAL_HOSTS.has(host)) {
    return { ok: false, error: "Link your product's own page, not a social profile." };
  }

  return { ok: true, normalized: parsed.toString() };
}

/**
 * `amount` arrives as DOLLARS, exactly as typed into the input. Accepts "12", "12.5",
 * "$12.50"; rejects anything that is not a plain positive number, so a NaN can never
 * reach the checkout.
 */
export function parseAmountCents(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) && cents > 0 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}

/** Opaque ad click id; malformed input is dropped rather than failing the claim. */
function sanitizeTwclid(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(text) ? text : null;
}

function clamp(raw: unknown, max: number): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function validateClaim(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request." };
  }
  const raw = body as Record<string, unknown>;

  // Picking an hour is optional. With no slotId the checkout assigns the earliest open
  // one, which is what almost every buyer gets.
  let slotId: string | null = null;
  if (raw.slotId !== undefined && raw.slotId !== null && String(raw.slotId).trim() !== "") {
    slotId = String(raw.slotId).trim();
    if (!/^\d+$/.test(slotId)) return { ok: false, error: "Pick an hour." };
  }

  const requestedHours = Number(raw.hours ?? 1);
  if (!Number.isInteger(requestedHours) || !isHomepageHours(requestedHours)) {
    return { ok: false, error: "Choose 1, 2, 3, or 6 homepage hours." };
  }

  const amountCents = parseAmountCents(raw.amount);
  if (amountCents === null) return { ok: false, error: "Enter a valid amount." };
  if (amountCents < MIN_ENTRY_CENTS) return { ok: false, error: "The minimum is $3." };

  const urlCheck = checkProductUrl(String(raw.url ?? ""));
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };

  return {
    ok: true,
    value: {
      slotId,
      hours: requestedHours,
      amountCents,
      url: urlCheck.normalized,
      name: clamp(raw.name, DISPLAY_NAME_MAX),
      pitch: clamp(raw.pitch, PITCH_MAX),
      twclid: sanitizeTwclid(raw.twclid),
    },
  };
}
