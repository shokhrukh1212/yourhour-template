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
  minimal = false,
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
  /** The claim panel already supplies labels and the live rank in its summary card. */
  minimal?: boolean;
}) {
  const cents = parseAmountCents(value);
  const belowMinimum = cents !== null && cents < minimumCents;
  const rank = cents === null ? null : rankForAmount(wallAmounts, cents);
  const beyondSample = capped && rank !== null && rank > wallAmounts.length;

  return (
    <div>
      {!minimal ? (
        <label htmlFor={id} className="block text-sm font-medium">
          {label}{" "}
          <span className="text-faint">min {formatPrice(minimumCents)}</span>
        </label>
      ) : null}
      <div
        className={`${minimal ? "" : "mt-1.5"} grid items-stretch gap-2 ${
          stepCents ? "grid-cols-[46px_1fr_46px]" : "grid-cols-1"
        }`}
      >
        {stepCents ? (
          <button
            type="button"
            aria-label="Pay less"
            onClick={() =>
              onChange(
                amountInputValue(Math.max(minimumCents, (cents ?? minimumCents) - stepCents)),
              )
            }
            className="rounded-[13px] border border-border bg-white/[.04] text-xl text-muted transition hover:border-violet hover:text-foreground"
          >
            −
          </button>
        ) : null}
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base text-muted">
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
            min={String(minimumCents / 100)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-12 w-full rounded-[13px] border border-border bg-black/25 pl-8 pr-4 font-bold tabular outline-none focus:border-violet"
          />
        </div>
        {stepCents ? (
          <button
            type="button"
            aria-label="Pay more"
            onClick={() => onChange(amountInputValue((cents ?? minimumCents) + stepCents))}
            className="rounded-[13px] border border-border bg-white/[.04] text-xl text-muted transition hover:border-violet hover:text-foreground"
          >
            +
          </button>
        ) : null}
      </div>

      {!minimal && belowMinimum ? (
        <p className="mt-2 text-xs text-accent">
          The minimum is {formatPrice(minimumCents)}.
        </p>
      ) : !minimal && rank !== null ? (
        <p className="mt-2 text-xs text-faint">
          This puts you at{" "}
          <span className="font-medium text-foreground tabular">
            #{beyondSample ? `${wallAmounts.length}+` : rank}
          </span>{" "}
          on the Wall.
        </p>
      ) : !minimal ? (
        <p className="mt-2 text-xs text-faint">{hint ?? "Pay more, rank higher."}</p>
      ) : null}
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

function amountInputValue(cents: number): string {
  return String(cents / 100);
}
