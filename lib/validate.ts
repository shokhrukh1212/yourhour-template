import { BLOCK_OPTIONS, STANDING_OPTIONS, WALL_MIN_CENTS } from "./pricing";

export const PITCH_MAX = 120;
export const DISPLAY_NAME_MAX = 60;

/** Nobody is paying this much for an hour, so anything above it is a typo or an attack. */
const AMOUNT_MAX_CENTS = 100_000_00;

export type ClaimInput = {
  /** "hour" buys airtime and moves the floor. "wall" buys a permanent spot and does not. */
  kind: "hour" | "wall";
  /** Null for a Wall-only purchase, which consumes no hour. */
  slotId: string | null;
  /** How many consecutive hours the block covers. Always 1 for a Wall purchase. */
  blockHours: number;
  /** The same hour on this many consecutive days. 0 when this is not a standing hour. */
  standingDays: number;
  /** What the buyer chose to pay, in cents. The server re-checks it against the floor. */
  amountCents: number;
  url: string;
  email: string;
  /** The handle credited with the hour. On a gift this is the RECIPIENT's. */
  xHandle: string | null;
  /** Who paid, when the hour is a gift. Null on an ordinary purchase. */
  gifterHandle: string | null;
};

export type ValidationResult =
  | { ok: true; value: ClaimInput }
  | { ok: false; error: string };

/** Blocks loopback and private ranges so a listing can't point at internal infrastructure. */
function isPublicHttpUrl(raw: string): { ok: boolean; normalized?: string } {
  let candidate = raw.trim();
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false };

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
    return { ok: false };
  }
  return { ok: true, normalized: parsed.toString() };
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function normalizeXHandle(value: string): string | null {
  const handle = value.trim().replace(/^@/, "");
  if (!handle) return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(handle) ? `@${handle}` : null;
}

/**
 * `amount` arrives as DOLLARS, exactly as typed into the input. Accepts "12", "12.5", "$12.50"; rejects
 * anything that is not a plain positive number, so a NaN can never reach the checkout.
 */
function parseAmountCents(raw: unknown): number | null {
  const text = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) && cents > 0 && cents <= AMOUNT_MAX_CENTS ? cents : null;
}

export function validateClaim(body: unknown): ValidationResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request." };
  }
  const raw = body as Record<string, unknown>;

  const kind = raw.kind === "wall" ? "wall" : "hour";

  let slotId: string | null = null;
  let blockHours = 1;
  let standingDays = 0;

  if (kind === "hour") {
    slotId = String(raw.slotId ?? "").trim();
    if (!/^\d+$/.test(slotId)) return { ok: false, error: "Pick an hour." };

    blockHours = Number(raw.blockHours ?? 1);
    if (!BLOCK_OPTIONS.some((b) => b.hours === blockHours)) {
      return { ok: false, error: "Pick 1 or 3 hours." };
    }

    standingDays = Number(raw.standingDays ?? 0);
    if (standingDays !== 0) {
      if (!STANDING_OPTIONS.some((s) => s.days === standingDays)) {
        return { ok: false, error: "A standing hour runs for 3 or 7 days." };
      }
      // The two shapes are alternatives, not layers: a standing hour holds one hour a
      // day, so a block length on top of it would have no meaning.
      if (blockHours !== 1) {
        return { ok: false, error: "A standing hour covers one hour a day." };
      }
    }
  }

  // The floor is a minimum, not a price. The exact minimum depends on the live board
  // price and the block, so it is enforced at reservation time under the board lock --
  // this only rules out amounts no purchase of either kind could ever be valid at.
  const amountCents = parseAmountCents(raw.amount);
  if (amountCents === null) return { ok: false, error: "Enter a valid amount." };
  if (kind === "wall" && amountCents < WALL_MIN_CENTS) {
    return { ok: false, error: "A Wall spot starts at $5." };
  }

  const urlCheck = isPublicHttpUrl(String(raw.url ?? ""));
  if (!urlCheck.ok) return { ok: false, error: "Enter a valid public http(s) URL." };

  const email = String(raw.email ?? "").trim().toLowerCase();
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email." };

  const rawHandle = String(raw.xHandle ?? "");
  let xHandle = normalizeXHandle(rawHandle);
  if (rawHandle.trim() && !xHandle) return { ok: false, error: "Enter a valid X handle." };

  // A gift credits the recipient everywhere the buyer would normally be credited, so
  // their handle takes over xHandle and the buyer's moves to gifterHandle. Both are
  // required: a gift with nobody to credit is just a purchase with a confusing email.
  let gifterHandle: string | null = null;
  if (raw.isGift === true || raw.isGift === "true") {
    const recipient = normalizeXHandle(String(raw.recipientHandle ?? ""));
    if (!recipient) return { ok: false, error: "Enter the recipient's X handle." };
    gifterHandle = normalizeXHandle(String(raw.gifterHandle ?? ""));
    if (!gifterHandle) return { ok: false, error: "Enter your own X handle." };
    xHandle = recipient;
  }

  return {
    ok: true,
    value: {
      kind,
      slotId,
      blockHours,
      standingDays,
      amountCents,
      url: urlCheck.normalized!,
      email,
      xHandle,
      gifterHandle,
    },
  };
}
