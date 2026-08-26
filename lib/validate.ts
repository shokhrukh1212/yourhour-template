export const PITCH_MAX = 180;
export const DISPLAY_NAME_MAX = 60;

const SOCIAL_HOSTS = new Set(["x.com","www.x.com","mobile.x.com","twitter.com","www.twitter.com","mobile.twitter.com"]);
export type PurchaseAttribution = { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null; referrer: string | null };
export type BidCheckoutInput = { url: string; targetBidCents: number; name: string | null; pitch: string | null; twclid: string | null; attribution: PurchaseAttribution };
export type BidValidationResult = { ok: true; value: BidCheckoutInput } | { ok: false; error: string };
export type UrlCheck = { ok: true; normalized: string } | { ok: false; error: string };

export function checkProductUrl(raw: string): UrlCheck {
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return { ok: false, error: "Enter a valid public http(s) URL." }; }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "Enter a valid public http(s) URL." };
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "[::1]" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^169\.254\./.test(host) || !host.includes(".")) return { ok: false, error: "Enter a valid public http(s) URL." };
  if (SOCIAL_HOSTS.has(host)) return { ok: false, error: "Link your product's own page, not a social profile." };
  return { ok: true, normalized: parsed.toString() };
}

export function parseInteger(raw: unknown): number | null {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function clampText(raw: unknown, max: number): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g," ");
  if (!text) return null;
  return text.length > max ? `${text.slice(0,max - 1).trimEnd()}…` : text;
}
function sanitizeTwclid(raw: unknown): string | null { const text = String(raw ?? "").trim(); return /^[A-Za-z0-9._-]{1,128}$/.test(text) ? text : null; }
function attributionValue(raw: unknown, max = 200): string | null { const text = String(raw ?? "").trim(); return text ? text.slice(0,max) : null; }
function sanitizeAttribution(raw: unknown): PurchaseAttribution {
  const value = typeof raw === "object" && raw !== null ? raw as Record<string,unknown> : {};
  return { utmSource:attributionValue(value.utmSource),utmMedium:attributionValue(value.utmMedium),utmCampaign:attributionValue(value.utmCampaign),utmContent:attributionValue(value.utmContent),utmTerm:attributionValue(value.utmTerm),referrer:attributionValue(value.referrer,500) };
}

export function validateBidCheckout(body: unknown): BidValidationResult {
  if (typeof body !== "object" || body === null) return { ok:false,error:"Invalid request." };
  const raw = body as Record<string,unknown>;
  const url = checkProductUrl(String(raw.url ?? ""));
  if (!url.ok) return { ok:false,error:url.error };
  const targetBidCents = parseInteger(raw.targetBidCents);
  if (targetBidCents === null || targetBidCents < 300 || targetBidCents % 100 !== 0) return { ok:false,error:"Choose a whole-dollar bid of at least $3." };
  if (targetBidCents > 1_000_000) return { ok:false,error:"The maximum bid is $10,000." };
  return { ok:true,value:{ url:url.normalized,targetBidCents,name:clampText(raw.name,DISPLAY_NAME_MAX),pitch:clampText(raw.pitch,PITCH_MAX),twclid:sanitizeTwclid(raw.twclid),attribution:sanitizeAttribution(raw.attribution) } };
}
