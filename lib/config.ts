function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
  siteName: process.env.SITE_NAME ?? "yourhour",

  /** Opening board price P, in cents. */
  boardStartPrice: int("BOARD_START_PRICE", 100),
  /** Hard floor for P, in cents. Spec section 3. */
  priceFloor: int("PRICE_FLOOR", 100),
  /** The day the board opened at boardStartPrice. Shown in the footer. UTC, YYYY-MM-DD. */
  boardStartDate: process.env.BOARD_START_DATE ?? "2026-08-22",
  /** How long a checkout holds the slot and freezes P. Spec section 3. */
  reservationMinutes: int("RESERVATION_MINUTES", 10),

  /** How far ahead the calendar is kept populated. Spec section 2. */
  calendarHours: int("CALENDAR_HOURS", 24),

  cronSecret: process.env.CRON_SECRET ?? "",
  ipHashSalt: process.env.IP_HASH_SALT ?? "dev-salt-change-me",

  lemonSqueezy: {
    apiKey: process.env.LEMONSQUEEZY_API_KEY ?? "",
    storeId: process.env.LEMONSQUEEZY_STORE_ID ?? "",
    variantId: process.env.LEMONSQUEEZY_VARIANT_ID ?? "",
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "",
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY ?? "",
    from: process.env.EMAIL_FROM ?? "yourhour <hello@yourhour.lol>",
  },

  x: {
    // Kill switch. X charges $0.20 per post containing a link (no free tier since Feb 2026).
    enabled: process.env.X_ANNOUNCE_ENABLED === "true",
    dailyPostCap: int("X_DAILY_POST_CAP", 24),
    /** The account the announcement comes from. Named in the 30-minute reminder email. */
    handle: process.env.X_HANDLE ?? "@shahzod1001",
    apiKey: process.env.X_API_KEY ?? "",
    apiSecret: process.env.X_API_SECRET ?? "",
    accessToken: process.env.X_ACCESS_TOKEN ?? "",
    accessSecret: process.env.X_ACCESS_SECRET ?? "",
  },

  vemetric: {
    token: process.env.VEMETRIC_TOKEN ?? "",
    publicDashboardUrl: process.env.VEMETRIC_PUBLIC_DASHBOARD_URL ?? "",
  },
} as const;

export function isXConfigured(): boolean {
  const { enabled, apiKey, apiSecret, accessToken, accessSecret } = config.x;
  return enabled && !!(apiKey && apiSecret && accessToken && accessSecret);
}

export function isLemonSqueezyConfigured(): boolean {
  const { apiKey, storeId, variantId } = config.lemonSqueezy;
  return !!(apiKey && storeId && variantId);
}
