"use client";

import { useEffect, useState } from "react";
import { purchaseEvent, trackMetaEventOnce } from "@/lib/meta-pixel";

export function PurchaseStatus({ intentId }: { intentId: string | null }) {
  const [message, setMessage] = useState(intentId ? "Confirming your payment…" : null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!intentId) return;
    let stopped = false; let attempts = 0;
    async function poll() {
      attempts += 1;
      try {
        const response = await fetch(`/api/checkout/status?r=${encodeURIComponent(intentId!)}`, { cache: "no-store" });
        const json = await response.json() as {
          ready?: boolean; status?: string; productName?: string; rank?: number;
          orderId?: string | null; amountPaidCents?: number | null;
        };
        if (stopped) return;
        if (json.ready) {
          // `ready` means the payment webhook verified and applied the charge, so this
          // is the first point at which a Purchase conversion is real -- and the value
          // comes from that stored order, not from the URL. Keyed on the order id, so a
          // refresh, a re-render or a second tab on this URL cannot recount it.
          const purchase = purchaseEvent(json, intentId);
          if (purchase) trackMetaEventOnce(`Purchase:${purchase.eventId}`, purchase);
          setMessage(`${json.productName ?? "Your product"} is now #${json.rank ?? "—"} on the leaderboard.`); setDone(true);
          const clean = new URL(window.location.href); clean.searchParams.delete("purchase"); clean.hash = "leaderboard";
          window.setTimeout(() => window.location.replace(clean), 900);
          return;
        }
        if (json.status === "expired") { setMessage("This checkout expired before payment completed."); setDone(true); return; }
      } catch { /* polling is best effort */ }
      if (!stopped && attempts < 20) window.setTimeout(poll, 1500);
      else if (!stopped) setMessage("Payment is still processing. Refresh this page in a moment.");
    }
    void poll();
    return () => { stopped = true; };
  }, [intentId]);
  if (!message) return null;
  return <div className={done ? "purchase-status done" : "purchase-status"} role="status">{message}</div>;
}
