function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
  siteName: process.env.SITE_NAME ?? "yourhour",

  /** How long an unpaid checkout holds supply capacity. */
  reservationMinutes: int("RESERVATION_MINUTES", 10),

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
    // The header's Stats link. Public by design, so it falls back to the live dashboard
    // rather than disappearing when the variable is missing from an environment.
    publicDashboardUrl:
      process.env.VEMETRIC_PUBLIC_DASHBOARD_URL ??
      "https://app.vemetric.com/public/yourhour.com",
  },

  xPixel: {
    // Not a secret -- it ships inside the browser tag.
    id: process.env.NEXT_PUBLIC_X_PIXEL_ID ?? "",
    // The Conversions API bearer. Server-only; never prefix with NEXT_PUBLIC_.
    accessToken: process.env.X_PIXEL_ACCESS_TOKEN ?? "",
    // Optional: the id of a specific conversion event created in X Ads Events Manager
    // (e.g. a "Purchase" action). Omitted from calls when unset.
    purchaseEventId: process.env.X_PIXEL_PURCHASE_EVENT_ID ?? "",
  },
} as const;

export function isLemonSqueezyConfigured(): boolean {
  const { apiKey, storeId, variantId } = config.lemonSqueezy;
  return !!(apiKey && storeId && variantId);
}
