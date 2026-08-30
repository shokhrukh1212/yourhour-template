"use client";

import { useEffect, useState } from "react";
import { purchaseEvent, trackMetaEventOnce } from "@/lib/meta-pixel";
import { useOvertake } from "./OvertakeProvider";

function removePurchaseLookupFromUrl(): void {
  const clean = new URL(window.location.href);
  clean.searchParams.delete("purchase");
  window.history.replaceState(window.history.state, "", `${clean.pathname}${clean.search}${clean.hash}`);
}

export function PurchaseStatus({ intentId }: { intentId: string | null }) {
  const [message, setMessage] = useState(intentId ? "Confirming your payment…" : null);
  const [done, setDone] = useState(false);
  const { beginVerifiedTakeover } = useOvertake();
  useEffect(() => {
    if (!intentId) return;
    let stopped = false;
    let attempts = 0;
    let timer: number | null = null;
    async function poll() {
      attempts += 1;
      try {
        const response = await fetch(`/api/checkout/status?r=${encodeURIComponent(intentId!)}`, { cache: "no-store" });
        const json = await response.json() as {
          ready?: boolean; status?: string; productName?: string; rank?: number;
          orderId?: string | null; amountPaidCents?: number | null;
          listingId?: string | null; bidCents?: number | null;
        };
        if (stopped) return;
        if (json.ready) {
          // `ready` means the payment webhook verified and applied the charge, so this
          // is the first point at which a Purchase conversion is real -- and the value
          // comes from that stored order, not from the URL. Keyed on the order id, so a
          // refresh, a re-render or a second tab on this URL cannot recount it.
          const purchase = purchaseEvent(json, intentId);
          if (purchase) trackMetaEventOnce(`Purchase:${purchase.eventId}`, purchase);
          // Clean the lookup before refreshing the RSC tree so Next's router state and
          // the visible URL agree. The verified result is already in memory here.
          removePurchaseLookupFromUrl();
          beginVerifiedTakeover(json);
          setMessage(json.rank === 1
            ? "You’re #1. Your product is now featured."
            : `${json.productName ?? "Your product"} is now #${json.rank ?? "—"} on the leaderboard.`);
          setDone(true);
          return;
        }
        if (["expired", "cancelled", "failed"].includes(json.status ?? "")) {
          setMessage(json.status === "expired"
            ? "This checkout expired before payment completed."
            : "Payment was not completed. Your leaderboard position has not changed.");
          setDone(true);
          removePurchaseLookupFromUrl();
          return;
        }
      } catch { /* polling is best effort */ }
      if (!stopped && attempts < 20) timer = window.setTimeout(poll, 1500);
      else if (!stopped) setMessage("Payment is still processing. Refresh this page in a moment.");
    }
    void poll();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [beginVerifiedTakeover, intentId]);
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [done]);
  if (!message) return null;
  return <div className={done ? "purchase-status done" : "purchase-status"} role="status" aria-live="polite">{message}</div>;
}
