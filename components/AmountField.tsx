"use client";

import { formatPrice } from "@/lib/pricing";
import { rankForAmount } from "@/lib/wall-rank";

/**
 * The amount a buyer chooses to pay, with the rank it buys shown live underneath.
 *
 * The amount IS the rank, so the rank has to move while they type rather than after a
 * round trip. `wallAmounts` is the descending list of amounts already on the Wall, so
 * the rank is a local binary search.
 */
export function AmountField({
  id,
  value,
  onChange,
  minimumCents,
  wallAmounts,
  capped,
  label = "Amount",
  hint,
  stepCents,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  minimumCents: number;
  wallAmounts: number[];
  capped: boolean;
  label?: string;
  hint?: string;
  /** When set, renders - / + buttons that nudge the amount by this many cents. */
  stepCents?: number;
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
      <div className="mt-1.5 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-faint">
            $
          </span>
          <input
            id={id}
            name={id}
            type="number"
            inputMode="decimal"
            required
            // The visible label is often just "min $3" (the panel labels the row
            // itself), so name the field explicitly for screen readers.
            aria-label={label || "Amount"}
            step="0.01"
            min={(minimumCents / 100).toFixed(2)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-xl border border-border bg-background py-3 pl-8 pr-4 text-base tabular focus:border-accent focus:outline-none"
          />
        </div>
        {stepCents ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              aria-label="Pay less"
              onClick={() =>
                onChange(
                  (Math.max(minimumCents, (cents ?? minimumCents) - stepCents) / 100).toFixed(2),
                )
              }
              className="h-11 w-11 rounded-xl border border-border text-lg text-muted transition hover:border-accent hover:text-accent"
            >
              −
            </button>
            <button
              type="button"
              aria-label="Pay more"
              onClick={() => onChange((((cents ?? minimumCents) + stepCents) / 100).toFixed(2))}
              className="h-11 w-11 rounded-xl border border-border text-lg text-muted transition hover:border-accent hover:text-accent"
            >
              +
            </button>
          </div>
        ) : null}
      </div>

      {belowMinimum ? (
        <p className="mt-2 text-xs text-accent">
          The minimum is {formatPrice(minimumCents)}.
        </p>
      ) : rank !== null ? (
        <p className="mt-2 text-xs text-faint">
          This puts you at{" "}
          <span className="font-medium text-foreground tabular">
            #{beyondSample ? `${wallAmounts.length}+` : rank}
          </span>{" "}
          on the Wall.
        </p>
      ) : (
        <p className="mt-2 text-xs text-faint">{hint ?? "Pay more, rank higher."}</p>
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
