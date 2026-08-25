import { CLICK_STEP, MAX_CLICKS, MIN_CLICKS } from "./pricing";

export const PITCH_MAX = 180;
export const DISPLAY_NAME_MAX = 60;

const SOCIAL_HOSTS = new Set([
  "x.com", "www.x.com", "mobile.x.com",
  "twitter.com", "www.twitter.com", "mobile.twitter.com",
]);

export type PurchaseInput = {
  mode: "purchase";
  clicks: number;
  url: string;
  name: string | null;
  pitch: string | null;
  twclid: string | null;
  attribution: PurchaseAttribution;
};

export type PurchaseAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
};

export type JumpInput = { mode: "jump"; campaignId: string };
export type CheckoutInput = PurchaseInput | JumpInput;

export type ValidationResult =
  | { ok: true; value: CheckoutInput }
  | { ok: false; error: string };

export type UrlCheck =
  | { ok: true; normalized: string }
  | { ok: false; error: string };

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
    host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" ||
    host === "[::1]" || /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || !host.includes(".")
  ) {
    return { ok: false, error: "Enter a valid public http(s) URL." };
  }
  if (SOCIAL_HOSTS.has(host)) {
    return { ok: false, error: "Link your product's own page, not a social profile." };
  }
  return { ok: true, normalized: parsed.toString() };
}

export function parseInteger(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function campaignId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return /^\d+$/.test(value) ? value : null;
}

function sanitizeTwclid(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  return /^[A-Za-z0-9._-]{1,128}$/.test(text) ? text : null;
}

function attributionValue(raw: unknown, max = 200): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  return text.slice(0, max);
}

function sanitizeAttribution(raw: unknown): PurchaseAttribution {
  const value = typeof raw === "object" && raw !== null
    ? raw as Record<string, unknown>
    : {};
  return {
    utmSource: attributionValue(value.utmSource),
    utmMedium: attributionValue(value.utmMedium),
    utmCampaign: attributionValue(value.utmCampaign),
    utmContent: attributionValue(value.utmContent),
    utmTerm: attributionValue(value.utmTerm),
    referrer: attributionValue(value.referrer, 500),
  };
}

function clampText(raw: unknown, max: number): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function validateCheckout(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request." };
  }
  const raw = body as Record<string, unknown>;
  const mode = String(raw.mode ?? "purchase");

  if (mode === "jump") {
    const id = campaignId(raw.campaignId);
    return id
      ? { ok: true, value: { mode, campaignId: id } }
      : { ok: false, error: "Campaign not found." };
  }

  if (mode !== "purchase") return { ok: false, error: "Invalid purchase mode." };
  const clicks = parseInteger(raw.clicks);
  if (clicks === null) return { ok: false, error: "Enter a whole number of clicks." };
  if (clicks < MIN_CLICKS) return { ok: false, error: `Minimum ${MIN_CLICKS} clicks.` };
  if (clicks > MAX_CLICKS) return { ok: false, error: `Maximum ${MAX_CLICKS} clicks per order.` };
  if (clicks % CLICK_STEP !== 0) {
    return { ok: false, error: `Choose clicks in increments of ${CLICK_STEP}.` };
  }
  const urlCheck = checkProductUrl(String(raw.url ?? ""));
  if (!urlCheck.ok) return { ok: false, error: urlCheck.error };
  return {
    ok: true,
    value: {
      mode,
      clicks,
      url: urlCheck.normalized,
      name: clampText(raw.name, DISPLAY_NAME_MAX),
      pitch: clampText(raw.pitch, PITCH_MAX),
      twclid: sanitizeTwclid(raw.twclid),
      attribution: sanitizeAttribution(raw.attribution),
    },
  };
}
