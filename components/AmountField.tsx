"use client";

import { formatPrice } from "@/lib/pricing";
import { rankForAmount } from "@/lib/wall-rank";

/**
 * The amount a buyer chooses to pay, with the rank it buys shown live underneath.
 *
 * The floor is a minimum, not a price, and the only reason to go above it is the Wall --
 * so the rank has to move while they type, not after a round trip. `wallAmounts` is the
 * descending list of amounts already on the Wall, so the rank is a local binary search.
 */
export function AmountField({
  id,
  value,
  onChange,
  minimumCents,
  wallAmounts,
  capped,
  label = "What you'll pay",
  hint,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  minimumCents: number;
  wallAmounts: number[];
  capped: boolean;
  label?: string;
  hint?: string;
}) {
  const cents = parseAmountCents(value);
  const belowMinimum = cents !== null && cents < minimumCents;
  const rank = cents === null ? null : rankForAmount(wallAmounts, cents);
  const beyondSample = capped && rank !== null && rank > wallAmounts.length;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}{" "}
        <span className="text-faint">min {formatPrice(minimumCents)}</span>
      </label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-faint">
          $
        </span>
        <input
          id={id}
          name={id}
          type="number"
          inputMode="decimal"
          required
          step="0.01"
          min={(minimumCents / 100).toFixed(2)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-border bg-background py-3 pl-8 pr-4 text-base tabular focus:border-accent focus:outline-none"
        />
      </div>

      {belowMinimum ? (
        <p className="mt-1.5 text-xs text-accent">
          The minimum is {formatPrice(minimumCents)}.
        </p>
      ) : rank !== null ? (
        <p className="mt-1.5 text-xs text-faint">
          This puts you at Wall rank{" "}
          <span className="font-medium text-foreground tabular">
            #{beyondSample ? `${wallAmounts.length}+` : rank}
          </span>
          .
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-faint">{hint ?? "Pay more, rank higher."}</p>
      )}
    </div>
  );
}

/** Mirrors parseAmountCents in lib/validate.ts -- the server is what actually decides. */
export function parseAmountCents(raw: string): number | null {
  const text = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

/** The top of the Wall, so a buyer can see what it takes to beat it. */
export function WallTopThree({
  top,
}: {
  top: { id: string; display_name: string | null; amount_paid: number }[];
}) {
  if (top.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-background px-5 py-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
        Top of The Wall
      </h3>
      <ul className="mt-2.5 space-y-1.5 text-sm">
        {top.map((entry, i) => (
          <li key={entry.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-muted">
              <span className="mr-2 text-faint tabular">#{i + 1}</span>
              {entry.display_name}
            </span>
            <span className="shrink-0 font-medium tabular">
              {formatPrice(entry.amount_paid)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
