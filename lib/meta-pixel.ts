/**
 * Browser-side helpers for the Meta Pixel tag installed in app/layout.tsx.
 *
 * The tag is initialised once there, from NEXT_PUBLIC_META_PIXEL_ID -- nothing here
 * inits a pixel or repeats its PageView. Every call no-ops when that variable is
 * unset, because `fbq` is then never defined, so callers never have to check whether
 * tracking is configured.
 *
 * What we send is deliberately minimal: an amount, USD, and one constant label. No
 * email, no buyer identifiers, no submitted product URLs, and no catalog parameters
 * (`contents`, `content_ids`, quantities) -- this account does not run catalog ads.
 *
 * The decision of *whether* an event is warranted lives in the pure functions below
 * rather than in the components, so it can be unit tested without a browser.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** The one thing every YourHour conversion is for. Constant, and not personal data. */
export const PLACEMENT_CONTENT_NAME = "YourHour homepage placement";

export type MetaEventName = "PageView" | "ViewContent" | "InitiateCheckout" | "Purchase";

export type MetaEventParams = {
  value?: number;
  currency?: "USD";
  content_name?: string;
};

export type MetaEvent = {
  name: MetaEventName;
  params: MetaEventParams;
  /**
   * Meta's `eventID`. Derived from our own order or checkout id, so a Conversions API
   * call added later can send the same value and have Meta collapse the browser and
   * server copies of one conversion into a single event.
   */
  eventId?: string;
};

/** What POST /api/checkout answers with. */
export type CheckoutSessionResponse = {
  checkoutUrl?: string;
  intentId?: string;
  amountDueCents?: number;
};

/** What GET /api/checkout/status answers with. */
export type CheckoutStatusResponse = {
  ready?: boolean;
  status?: string;
  orderId?: string | null;
  amountPaidCents?: number | null;
};

function amountFromCents(cents: unknown): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return cents / 100;
}

/**
 * An InitiateCheckout only once the server actually created a payment session. A
 * rejected or failed checkout returns no URL and therefore no event.
 */
export function initiateCheckoutEvent(
  response: CheckoutSessionResponse | null | undefined,
  selectedAmountCents: number,
): MetaEvent | null {
  if (!response?.checkoutUrl) return null;
  // The server's price is authoritative; the locally selected amount is only a fallback.
  const value = amountFromCents(response.amountDueCents) ?? amountFromCents(selectedAmountCents);
  if (value === null) return null;
  return {
    name: "InitiateCheckout",
    params: { value, currency: "USD", content_name: PLACEMENT_CONTENT_NAME },
    eventId: response.intentId || undefined,
  };
}

/**
 * A Purchase only once the payment provider's webhook verified and applied the charge,
 * which is what `ready` reports. The value comes from the stored order, never from a
 * URL parameter or anything the browser chose: an unverified, pending, expired or
 * cancelled checkout produces no event at all.
 */
export function purchaseEvent(
  status: CheckoutStatusResponse | null | undefined,
  fallbackEventId?: string | null,
): MetaEvent | null {
  if (!status?.ready) return null;
  if (typeof status.status === "string" && status.status !== "completed") return null;
  const value = amountFromCents(status.amountPaidCents);
  if (value === null) return null;
  const eventId = (typeof status.orderId === "string" && status.orderId) || fallbackEventId || undefined;
  if (!eventId) return null;
  return {
    name: "Purchase",
    params: { value, currency: "USD", content_name: PLACEMENT_CONTENT_NAME },
    eventId,
  };
}

type EventStorage = Pick<Storage, "getItem" | "setItem">;

/** Survives re-renders, Strict Mode's double effects and repeated poll responses. */
const sentThisPageLoad = new Set<string>();

function defaultStorage(): EventStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Records that an event was reported and answers whether this caller is the first to
 * do so. Two layers, because they fail in different ways: the in-memory set covers one
 * page load even when storage is unavailable (private windows, blocked cookies), and
 * localStorage covers refreshes and return visits to a confirmation URL. When neither
 * can remember, the stable eventID still lets Meta drop the repeat.
 */
export function markMetaEventSent(key: string, storage: EventStorage | null = defaultStorage()): boolean {
  if (sentThisPageLoad.has(key)) return false;
  const storageKey = `meta-pixel:${key}`;
  try {
    if (storage?.getItem(storageKey)) {
      sentThisPageLoad.add(key);
      return false;
    }
    storage?.setItem(storageKey, "1");
  } catch {
    // Storage refused -- rely on the in-memory set and the eventID.
  }
  sentThisPageLoad.add(key);
  return true;
}

/** Test seam: forget what this page load has already reported. */
export function resetMetaEventMemory(): void {
  sentThisPageLoad.clear();
}

export function trackMetaEvent(event: MetaEvent): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  try {
    if (event.eventId) window.fbq("track", event.name, event.params, { eventID: event.eventId });
    else window.fbq("track", event.name, event.params);
  } catch {
    // Ad tracking must never break the page.
  }
}

/** Reports `event` at most once per `key`, across refreshes and re-renders alike. */
export function trackMetaEventOnce(key: string, event: MetaEvent): void {
  if (!markMetaEventSent(key)) return;
  trackMetaEvent(event);
}

/** PageView for App Router navigations, which do not reload the document. */
export function trackMetaPageView(): void {
  trackMetaEvent({ name: "PageView", params: {} });
}
