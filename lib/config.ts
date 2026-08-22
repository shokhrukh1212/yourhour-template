function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
  siteName: process.env.SITE_NAME ?? "yourhour",

  /** How long a checkout holds the hour it was assigned. */
  reservationMinutes: int("RESERVATION_MINUTES", 10),

  /** How far ahead the calendar is kept populated. */
  calendarHours: int("CALENDAR_HOURS", 24),

  cronSecret: process.env.CRON_SECRET ?? "",
  ipHashSalt: process.env.IP_HASH_SALT ?? "dev-salt-change-me",

  lemonSqueezy: {
    apiKey: process.env.LEMONSQUEEZY_API_KEY ?? "",
    storeId: process.env.LEMONSQUEEZY_STORE_ID ?? "",
    variantId: process.env.LEMONSQUEEZY_VARIANT_ID ?? "",
    webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? "",
  },

  vemetric: {
    token: process.env.VEMETRIC_TOKEN ?? "",
    publicDashboardUrl: process.env.VEMETRIC_PUBLIC_DASHBOARD_URL ?? "",
  },
} as const;

export function isLemonSqueezyConfigured(): boolean {
  const { apiKey, storeId, variantId } = config.lemonSqueezy;
  return !!(apiKey && storeId && variantId);
}
