"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { vemetric } from "@vemetric/react";
import { AmountField, parseAmountCents } from "@/components/AmountField";
import { LocalTime } from "@/components/LocalTime";
import { Logo } from "@/components/Logo";
import { VisitorCount } from "@/components/VisitorCount";
import { MIN_ENTRY_CENTS, OUTBID_STEP_CENTS, formatPrice } from "@/lib/pricing";
import { WALL_RANK_SAMPLE, rankForAmount } from "@/lib/wall-rank";

export type OpenHour = { id: string; startsAtIso: string };

type Preview = {
  url: string;
  productName: string;
  pitch: string | null;
  scraped: boolean;
};

/**
 * The whole purchase, in two actions: paste a URL and click, then pay.
 *
 * Sticky at the top of the viewport at every scroll position, because it is the only
 * thing on the page a visitor is meant to do. Everything optional -- the amount, which
 * hour, a hand-written name when the scrape fails -- lives in the panel behind it, with
 * a working default already filled in.
 */
export function ClaimBar({
  numberOneCents,
  wallAmounts,
  openHours,
  nextOpenIso,
  visits,
  statsUrl,
}: {
  numberOneCents: number;
  wallAmounts: number[];
  /** Every hour still on the board, for the optional picker. */
  openHours: OpenHour[];
  /** The hour a buyer gets if they pick nothing. Null when the board is full. */
  nextOpenIso: string | null;
  visits: number;
  statsUrl?: string;
}) {
  const panelId = useId();
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [amount, setAmount] = useState(() => (numberOneCents / 100).toFixed(2));
  const [slotId, setSlotId] = useState<string>("");
  const [pickingHour, setPickingHour] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const urlRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  // Esc closes, and the input is refocused so the next attempt takes no extra click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        urlRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The hero's "Claim your spot" button and anything else linking to #claim lands here.
  useEffect(() => {
    const focus = () => urlRef.current?.focus();
    window.addEventListener("yourhour:focus-claim", focus);
    return () => window.removeEventListener("yourhour:focus-claim", focus);
  }, []);

  const chosenCents = parseAmountCents(amount);
  const effectiveCents = chosenCents ?? numberOneCents;
  const belowMinimum = chosenCents !== null && chosenCents < MIN_ENTRY_CENTS;

  const chosenHourIso =
    (slotId && openHours.find((h) => h.id === slotId)?.startsAtIso) ||
    nextOpenIso;

  async function onClaim(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);
    setOpen(true);
    setPreview(null);

    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await res.json()) as Preview & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "We couldn't read that link.");
        setOpen(false);
        return;
      }
      setPreview(json);
      setName(json.productName);
      setPitch(json.pitch ?? "");
      vemetric.trackEvent("claim_opened", {
        eventData: { scraped: json.scraped },
      });
    } catch {
      setError("Network error. Try again.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function onPay(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !preview) return;
    if (belowMinimum) {
      setError(`The minimum is ${formatPrice(MIN_ENTRY_CENTS)}.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: preview.url,
          amount,
          slotId: slotId || undefined,
          // Only meaningful when the scrape failed; the server prefers what it read.
          name: preview.scraped ? undefined : name,
          pitch: preview.scraped ? undefined : pitch,
        }),
      });
      const json = (await res.json()) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not start checkout. Try again.");
        return;
      }
      vemetric.trackEvent("checkout_started", {
        eventData: { amountCents: effectiveCents },
      });
      window.location.assign(json.checkoutUrl);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sticky top-0 z-50">
      {/* Brand row. Thin on purpose -- the row under it is the one that matters. */}
      <div className="border-b border-border bg-background/95 px-4 py-2.5 text-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2 font-medium">
            <Logo className="h-5 w-5" />
            <span>
              yourhour<span className="text-faint">.lol</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-muted">
            <VisitorCount initialCount={visits} statsUrl={statsUrl} />
            <Link href="/rules" className="hover:text-accent">
              Rules
            </Link>
            <Link href="/about" className="hover:text-accent">
              About
            </Link>
          </nav>
        </div>
      </div>

      {/* Claim row. */}
      <div className="border-b border-border bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <form
          onSubmit={onClaim}
          className="mx-auto flex w-full max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-3"
        >
          <span className="shrink-0 text-sm font-medium">
            Claim <span className="tabular">#1</span>
            <span className="text-faint"> — </span>
            <span className="tabular text-accent">
              {formatPrice(numberOneCents)}
            </span>
          </span>
          <input
            ref={urlRef}
            id="claim-url"
            name="url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourproduct.com"
            aria-label="Your product URL"
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-base focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-base font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {loading ? "Reading…" : "Claim #1"}
          </button>
        </form>
        <p className="mx-auto mt-1.5 w-full max-w-5xl text-xs text-faint">
          Or pay any amount from {formatPrice(MIN_ENTRY_CENTS)} and take the
          rank it earns.
        </p>
        {!open && error ? (
          <p
            role="alert"
            className="mx-auto mt-2 w-full max-w-5xl text-xs text-accent"
          >
            {error}
          </p>
        ) : null}
      </div>

      {open ? (
        <>
          {/* Overlaid rather than inserted, so opening the panel never shifts the page. */}
          <div
            className="fixed inset-0 -z-10 bg-background/70 backdrop-blur-sm"
            onClick={close}
            aria-hidden
          />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-label="Claim your spot"
            className="absolute inset-x-0 top-full max-h-[calc(100svh-6rem)] overflow-y-auto border-b border-border bg-surface shadow-xl"
          >
            <form
              onSubmit={onPay}
              className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"
            >
              <Row label="Your product">
                {!preview ? (
                  <span className="flex items-center gap-2 text-muted">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
                    Reading {hostOf(url)}…
                  </span>
                ) : preview.scraped ? (
                  <>
                    <p className="text-base font-medium">
                      {preview.productName}
                    </p>
                    {preview.pitch ? (
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {preview.pitch}
                      </p>
                    ) : null}
                  </>
                ) : (
                  // Only shown when the page could not be read at all.
                  <div className="space-y-2">
                    <p className="text-xs text-faint">
                      We couldn&apos;t read that page. Fill these in and
                      we&apos;ll use them.
                    </p>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={60}
                      placeholder="Product name"
                      aria-label="Product name"
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-base focus:border-accent focus:outline-none"
                    />
                    <input
                      value={pitch}
                      onChange={(e) => setPitch(e.target.value)}
                      maxLength={120}
                      placeholder="One line about what it does"
                      aria-label="Product pitch"
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                    />
                  </div>
                )}
              </Row>

              <Row label="Amount">
                <AmountField
                  id="amount"
                  label=""
                  value={amount}
                  onChange={setAmount}
                  minimumCents={MIN_ENTRY_CENTS}
                  wallAmounts={wallAmounts}
                  capped={wallAmounts.length >= WALL_RANK_SAMPLE}
                  stepCents={OUTBID_STEP_CENTS}
                />
                <button
                  type="button"
                  onClick={() => setPickingHour((v) => !v)}
                  className="mt-2 text-xs text-faint underline underline-offset-4 hover:text-accent"
                >
                  {pickingHour
                    ? "never mind, take the next open hour"
                    : "pick a specific hour instead"}
                </button>
                {pickingHour ? (
                  <select
                    value={slotId}
                    onChange={(e) => setSlotId(e.target.value)}
                    aria-label="Which hour"
                    className="mt-2 w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
                  >
                    <option value="">Next open hour</option>
                    {openHours.map((hour) => (
                      <option key={hour.id} value={hour.id}>
                        {new Date(hour.startsAtIso).toLocaleString([], {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </option>
                    ))}
                  </select>
                ) : null}
              </Row>

              <Row label="You get">
                <p className="text-sm leading-relaxed text-muted">
                  Permanent rank{" "}
                  <span className="font-medium text-foreground tabular">
                    #{rankForAmount(wallAmounts, effectiveCents)}
                  </span>{" "}
                  on the Wall, plus{" "}
                  {chosenHourIso ? (
                    <>
                      {slotId ? "your hour" : "the next open hour"} on the
                      homepage —{" "}
                      <span className="font-medium text-foreground">
                        <LocalTime iso={chosenHourIso} mode="when" />
                      </span>
                      .
                    </>
                  ) : (
                    <>an hour on the homepage.</>
                  )}
                </p>
              </Row>

              {error ? (
                <p
                  role="alert"
                  className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting || !preview}
                className="mt-6 w-full rounded-xl bg-accent px-6 py-3.5 text-base font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {submitting
                  ? "Starting checkout…"
                  : `Pay ${formatPrice(effectiveCents)}`}
              </button>
              <button
                type="button"
                onClick={close}
                className="mt-3 w-full text-center text-xs text-faint hover:text-accent"
              >
                Cancel
              </button>
            </form>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-border py-4 first:pt-0 last:border-0 sm:grid-cols-[7rem_1fr] sm:gap-4">
      <span className="pt-0.5 text-sm font-medium text-faint">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function hostOf(raw: string): string {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "your page";
  }
}
