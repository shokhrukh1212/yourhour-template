"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    twq?: (...args: unknown[]) => void;
  }
}

/**
 * Fires the X Ads "Purchase" conversion once per sale. Reloading this page must not
 * inflate the count, so firing is gated on a flag keyed by the same id the
 * server-side Conversions API call uses for dedup (see lib/x-ads.ts) -- when both
 * carry the same conversion_id, X collapses the browser and server signals into one
 * conversion instead of counting it twice.
 */
export function XPurchaseEvent({
  eventId,
  conversionId,
  amountCents,
  currency,
}: {
  /** config.xPixel.purchaseEventId, e.g. "tw-rem4r-remj0". Skipped when unset. */
  eventId: string;
  conversionId: string;
  amountCents: number;
  currency: string;
}) {
  useEffect(() => {
    if (!eventId) return;
    try {
      const flag = `x-purchase-tracked:${conversionId}`;
      if (localStorage.getItem(flag) || typeof window.twq !== "function") return;
      window.twq("event", eventId, {
        value: (amountCents / 100).toFixed(2),
        currency,
        conversion_id: conversionId,
      });
      localStorage.setItem(flag, "1");
    } catch {
      // Storage can be blocked in embedded browsers; skip rather than risk double-firing.
    }
  }, [eventId, conversionId, amountCents, currency]);

  return null;
}
