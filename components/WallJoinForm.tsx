"use client";

import { useState } from "react";
import { vemetric } from "@vemetric/react";
import { WALL_MIN_CENTS, formatPrice } from "@/lib/pricing";
import { WALL_RANK_SAMPLE } from "@/lib/wall-rank";
import { AmountField, parseAmountCents } from "./AmountField";

/**
 * The second product: a permanent Wall spot with no hour attached. It consumes no slot
 * and does not move the board price, so there is no inventory and nothing to run out of
 * -- which is the point. It sells on the hours when every hour is already sold.
 */
export function WallJoinForm({ wallAmounts }: { wallAmounts: number[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState((WALL_MIN_CENTS / 100).toFixed(2));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const cents = parseAmountCents(amount);
    if (cents === null || cents < WALL_MIN_CENTS) {
      setError(`A Wall spot starts at ${formatPrice(WALL_MIN_CENTS)}.`);
      return;
    }
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      kind: "wall" as const,
      amount,
      url: String(form.get("wallUrl") ?? "").trim(),
      email: String(form.get("wallEmail") ?? "").trim(),
      xHandle: String(form.get("wallXHandle") ?? "").trim(),
    };

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { checkoutUrl?: string; error?: string };

      if (!res.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not start checkout. Try again.");
        setSubmitting(false);
        return;
      }
      vemetric.trackEvent("wall_checkout_started", { eventData: { amount: payload.amount } });
      window.location.href = json.checkoutUrl;
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-10 rounded-2xl border border-border bg-surface p-6">
      <p className="text-sm leading-relaxed text-muted">
        Don&apos;t want to wait for an hour? Buy a permanent spot on the Wall.
        <br />
        From {formatPrice(WALL_MIN_CENTS)}. Never expires.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-full border border-accent px-6 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
        >
          Join the Wall
        </button>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <AmountField
            id="wallAmount"
            value={amount}
            onChange={setAmount}
            minimumCents={WALL_MIN_CENTS}
            wallAmounts={wallAmounts}
            capped={wallAmounts.length >= WALL_RANK_SAMPLE}
          />

          <div>
            <label htmlFor="wallUrl" className="block text-sm font-medium">
              Your URL
            </label>
            <input
              id="wallUrl"
              name="wallUrl"
              type="url"
              required
              placeholder="https://yourproduct.com"
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-faint">
              We&apos;ll pull your product name and pitch from this page.
            </p>
          </div>

          <div>
            <label htmlFor="wallEmail" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="wallEmail"
              name="wallEmail"
              type="email"
              required
              placeholder="you@example.com"
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-faint">For your receipt.</p>
          </div>

          <div>
            <label htmlFor="wallXHandle" className="block text-sm font-medium">
              X handle <span className="text-faint">(optional)</span>
            </label>
            <input
              id="wallXHandle"
              name="wallXHandle"
              type="text"
              placeholder="@yourproduct"
              maxLength={16}
              className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
              {error}
            </p>
          ) : null}

          <div className="rounded-xl border border-border bg-background p-5 text-sm leading-relaxed">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
              What you&apos;re buying
            </h3>
            <p className="mt-2 text-muted">
              A permanent row on The Wall, ranked by what you paid, with a counted link
              and a page of your own at yourhour.lol/u/your-product. Not an hour on the
              homepage — that&apos;s the other product, and it&apos;s the one that comes
              with an X announcement and the full takeover.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-accent px-6 py-3.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Starting checkout…" : "Join the Wall"}
          </button>
        </form>
      )}
    </div>
  );
}
