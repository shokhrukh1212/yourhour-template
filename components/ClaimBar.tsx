"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { vemetric } from "@vemetric/react";
import { AmountField, parseAmountCents } from "@/components/AmountField";
import { ArrowIcon } from "@/components/ArrowIcon";
import { LocalTime } from "@/components/LocalTime";
import { Logo } from "@/components/Logo";
import { ProductLogo } from "@/components/ProductLogo";
import { MIN_ENTRY_CENTS, OUTBID_STEP_CENTS, formatPrice } from "@/lib/pricing";
import { WALL_RANK_SAMPLE, rankForAmount } from "@/lib/wall-rank";

export type OpenHour = { id: string; startsAtIso: string };

type Preview = {
  url: string;
  productName: string;
  pitch: string | null;
  imageUrl: string | null;
  scraped: boolean;
  existing: {
    id: string;
    amount_paid: number;
    display_name: string | null;
    slug: string | null;
    rank: number;
  } | null;
};

type RankSelection = { rank: number; amountCents: number };
const HOMEPAGE_HOURS = [1, 2, 3, 6] as const;
type HomepageHours = (typeof HOMEPAGE_HOURS)[number];

/** The sticky two-row header and its complete two-action checkout panel. */
export function ClaimBar({
  numberOneCents,
  wallAmounts,
  openHours,
  nextOpenIso,
  allTimeClicks,
  statsUrl,
}: {
  numberOneCents: number;
  wallAmounts: number[];
  openHours: OpenHour[];
  nextOpenIso: string | null;
  allTimeClicks: number;
  statsUrl?: string;
}) {
  const panelId = useId();
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [amount, setAmount] = useState(() => String(numberOneCents / 100));
  const [selectedRank, setSelectedRank] = useState<RankSelection | null>(null);
  const [slotId, setSlotId] = useState("");
  const [hours, setHours] = useState<HomepageHours>(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const urlRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const claimRef = useRef<HTMLElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const reveal = useCallback((focusInput = true) => {
    claimRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(true);
    requestAnimationFrame(() => {
      if (focusInput) urlRef.current?.focus();
      else closeRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  useEffect(() => {
    const focus = () => reveal(true);
    const takeRank = (event: Event) => {
      const detail = (event as CustomEvent<RankSelection>).detail;
      if (!detail || detail.amountCents < MIN_ENTRY_CENTS) return;
      setAmount(String(detail.amountCents / 100));
      setSelectedRank(detail);
      setError(null);
      reveal(true);
    };
    const selectHour = (event: Event) => {
      const detail = (event as CustomEvent<{ slotId?: string }>).detail;
      if (!detail?.slotId || !openHours.some((hour) => hour.id === detail.slotId)) return;
      setSlotId(detail.slotId);
      setError(null);
      reveal(true);
    };

    window.addEventListener("yourhour:focus-claim", focus);
    window.addEventListener("yourhour:take-rank", takeRank);
    window.addEventListener("yourhour:select-hour", selectHour);
    return () => {
      window.removeEventListener("yourhour:focus-claim", focus);
      window.removeEventListener("yourhour:take-rank", takeRank);
      window.removeEventListener("yourhour:select-hour", selectHour);
    };
  }, [openHours, reveal]);

  const chosenCents = parseAmountCents(amount);
  const effectiveCents = chosenCents ?? numberOneCents;
  const belowMinimum = chosenCents !== null && chosenCents < MIN_ENTRY_CENTS;
  const existing = preview?.existing ?? null;
  const upgradeDifference = existing ? effectiveCents - existing.amount_paid : null;
  const isValidUpgrade = upgradeDifference === null || upgradeDifference > 0;
  const targetRank = rankForAmount(wallAmounts, effectiveCents);
  const checkoutCents = existing
    ? Math.max(0, upgradeDifference ?? 0)
    : effectiveCents * hours;
  const claimRank = selectedRank?.rank ?? 1;
  const claimPrice = selectedRank?.amountCents ?? numberOneCents;
  const formattedAllTimeClicks = allTimeClicks.toLocaleString("en-US");
  const compactAllTimeClicks =
    allTimeClicks >= 1_000_000
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(allTimeClicks)
      : formattedAllTimeClicks;
  const chosenHourIso =
    (slotId && openHours.find((hour) => hour.id === slotId)?.startsAtIso) || nextOpenIso;

  async function onClaim(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || loading) return;

    setLoading(true);
    setError(null);
    setOpen(true);
    setPreview(null);

    try {
      const response = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = (await response.json()) as Preview & { error?: string };
      if (!response.ok) {
        setError(json.error ?? "We couldn't read that link.");
        return;
      }
      setPreview(json);
      setName(json.productName);
      setPitch(json.pitch ?? "");
      if (json.existing) {
        setSlotId("");
        setHours(1);
      }
      vemetric.trackEvent("claim_opened", { eventData: { scraped: json.scraped } });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onPay(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !url.trim()) return;
    if (belowMinimum) {
      setError(`The minimum is ${formatPrice(MIN_ENTRY_CENTS)}.`);
      return;
    }
    if (!isValidUpgrade) {
      setError("Choose an amount higher than your current Wall amount.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: preview?.url ?? url,
          amount,
          slotId: slotId || undefined,
          hours: existing ? 1 : hours,
          name: preview?.scraped ? undefined : name || undefined,
          pitch: preview?.scraped ? undefined : pitch || undefined,
          twclid: new URLSearchParams(window.location.search).get("twclid") || undefined,
        }),
      });
      const json = (await response.json()) as { checkoutUrl?: string; error?: string };
      if (!response.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not start checkout. Try again.");
        return;
      }
      vemetric.trackEvent("checkout_started", {
        eventData: { amountCents: checkoutCents, hours: existing ? 1 : hours, upgrade: Boolean(existing) },
      });
      window.location.assign(json.checkoutUrl);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close claim panel"
          className="fixed inset-0 z-40 cursor-default border-0 bg-black/75 backdrop-blur-md"
          onClick={close}
        />
      ) : null}

      <header ref={claimRef} id="claim" className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-2xl">
        <div className="landing-shell flex h-[62px] items-center justify-between">
          <Link href="/#now" className="inline-flex items-center gap-2.5 text-[17px] font-bold tracking-[-.035em]">
            <Logo className="h-[25px] w-[25px]" />
            <span>
              yourhour<span className="text-faint">.lol</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-[13px] text-muted sm:gap-5 lg:gap-7">
            <span
              aria-label={`${formattedAllTimeClicks} outbound product clicks since launch`}
              title={`${formattedAllTimeClicks} outbound product clicks since launch`}
              className="inline-flex shrink-0 items-baseline whitespace-nowrap text-[11px] text-faint"
            >
              <span aria-hidden="true" className="inline-flex items-baseline gap-1 lg:hidden">
                <b className="font-semibold text-muted tabular">{compactAllTimeClicks}</b>
                <span>clicks</span>
              </span>
              <span aria-hidden="true" className="hidden items-baseline gap-1 lg:inline-flex">
                <b className="font-semibold text-muted tabular">{formattedAllTimeClicks}</b>
                <span>all-time clicks</span>
              </span>
            </span>
            {statsUrl ? (
              <a
                href={statsUrl}
                target="_blank"
                rel="noopener"
                title="Open the public visitor dashboard"
                className="hidden hover:text-foreground sm:block"
              >
                Stats
              </a>
            ) : null}
            <a href="#wall" className="hidden hover:text-foreground sm:block">
              Leaderboard
            </a>
            <a href="#hours" className="hidden hover:text-foreground sm:block">
              Hours
            </a>
            <a href="#how" className="hidden hover:text-foreground sm:block">
              How it works
            </a>
          </nav>
        </div>

        <div className="landing-shell relative">
          <form
            onSubmit={onClaim}
            className="grid min-h-[78px] grid-cols-[1fr_auto] items-center gap-3 sm:grid-cols-[auto_minmax(220px,1fr)_auto]"
          >
            <div className="hidden min-w-[190px] items-baseline gap-2 text-sm sm:flex">
              <span className="font-semibold">
                {selectedRank ? `Claim rank #${claimRank}` : "Claim the top spot"}
              </span>
              <strong className="text-base text-accent tabular">{formatPrice(claimPrice)}</strong>
            </div>
            <label className="relative">
              <span className="sr-only">Your product URL</span>
              <span className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 text-sm text-faint sm:block">
                https://
              </span>
              <input
                ref={urlRef}
                id="claim-url"
                name="url"
                type="url"
                required
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPreview(null);
                  setError(null);
                }}
                onFocus={() => setOpen(true)}
                placeholder="Paste your product URL"
                aria-controls={panelId}
                className="h-[50px] w-full rounded-[14px] border border-border bg-white/[.045] px-4 text-foreground outline-none transition placeholder:text-faint focus:border-violet focus:bg-white/[.07] sm:pl-[76px]"
              />
            </label>
            <button
              ref={triggerRef}
              type="submit"
              disabled={loading}
              className="inline-flex h-[50px] w-[50px] items-center justify-center gap-2.5 rounded-[14px] border-0 bg-accent px-0 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto sm:px-5"
            >
              <span className="hidden sm:inline">{loading ? "Reading…" : `Claim #${claimRank}`}</span>
              <ArrowIcon />
            </button>
          </form>

          {open ? (
            <div
              id={panelId}
              role="dialog"
              aria-modal="true"
              aria-label="Claim your hour"
              className="landing-claim-panel absolute inset-x-0 top-full rounded-b-3xl border border-white/[.18] bg-surface p-5 shadow-2xl sm:p-7"
            >
              <div className="flex items-start justify-between gap-5 border-b border-border pb-5">
                <div>
                  <span className="landing-eyebrow">Claim your hour</span>
                  <h2 className="mt-2 text-2xl font-normal tracking-[-.05em] sm:text-4xl">
                    Put your product in the spotlight.
                  </h2>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={close}
                  aria-label="Close claim panel"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-white/[.04] text-2xl leading-none text-muted transition hover:border-white/20 hover:text-foreground"
                >
                  ×
                </button>
              </div>

              <form onSubmit={onPay} className="grid gap-7 pt-6 lg:grid-cols-[1.25fr_.75fr]">
                <div className="space-y-5">
                  <PanelRow label="Homepage time" hint="Consecutive hours">
                    <div className="grid grid-cols-4 rounded-[14px] border border-border bg-black/25 p-1">
                      {HOMEPAGE_HOURS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={Boolean(existing)}
                          aria-pressed={hours === option}
                          onClick={() => setHours(option)}
                          className={`h-[42px] rounded-[10px] transition ${
                            hours === option
                              ? "bg-violet font-bold text-white shadow-[0_10px_28px_rgba(98,65,196,.25)]"
                              : "text-muted hover:bg-white/[.05] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                          }`}
                        >
                          {option}h
                        </button>
                      ))}
                    </div>
                  </PanelRow>

                  <PanelRow label="Bid per hour" hint={`${formatPrice(MIN_ENTRY_CENTS)} minimum`}>
                    <AmountField
                      id="amount"
                      label="Bid per hour"
                      value={amount}
                      onChange={(next) => {
                        setAmount(next);
                        setSelectedRank(null);
                      }}
                      minimumCents={MIN_ENTRY_CENTS}
                      wallAmounts={wallAmounts}
                      capped={wallAmounts.length >= WALL_RANK_SAMPLE}
                      stepCents={OUTBID_STEP_CENTS}
                      minimal
                    />
                  </PanelRow>

                  <PanelRow label="Starts" hint="Your local time">
                    <label className="relative block">
                      <span className="sr-only">Choose a homepage hour</span>
                      <select
                        value={slotId}
                        onChange={(event) => setSlotId(event.target.value)}
                        disabled={Boolean(existing)}
                        style={{ colorScheme: "dark" }}
                        className="h-12 w-full appearance-none rounded-[13px] border border-border bg-black/25 px-4 pr-12 outline-none focus:border-violet disabled:opacity-55"
                      >
                        <option value="" className="bg-surface text-foreground">
                          Next open hour
                        </option>
                        {openHours.map((hour) => (
                          <option key={hour.id} value={hour.id} className="bg-surface text-foreground">
                            {new Date(hour.startsAtIso).toLocaleString([], {
                              weekday: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-faint">
                        ⌄
                      </span>
                    </label>
                  </PanelRow>

                  {loading ? (
                    <div className="flex items-center gap-2 rounded-[14px] border border-border bg-black/20 px-4 py-3 text-sm text-muted">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent" />
                      Reading {hostOf(url)}…
                    </div>
                  ) : preview ? (
                    <div className="rounded-[14px] border border-border bg-black/20 p-4">
                      <div className="flex items-start gap-3">
                        <ProductLogo
                          imageUrl={preview.imageUrl}
                          productUrl={preview.url}
                          productName={preview.productName}
                          className="h-11 w-11 rounded-xl"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold">{preview.productName}</p>
                          {preview.pitch ? (
                            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                              {preview.pitch}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {!preview.scraped ? (
                        <div className="mt-4 grid gap-2">
                          <p className="text-xs text-faint">
                            We couldn&apos;t read that page. Confirm the details below.
                          </p>
                          <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                            maxLength={60}
                            placeholder="Product name"
                            aria-label="Product name"
                            className="h-11 rounded-[13px] border border-border bg-black/25 px-4 outline-none focus:border-violet"
                          />
                          <input
                            value={pitch}
                            onChange={(event) => setPitch(event.target.value)}
                            maxLength={180}
                            placeholder="One line about what it does"
                            aria-label="Product pitch"
                            className="h-11 rounded-[13px] border border-border bg-black/25 px-4 text-sm outline-none focus:border-violet"
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <aside className="rounded-[20px] border border-accent/20 bg-gradient-to-br from-accent/[.08] to-violet/[.07] p-5">
                  <div className="flex items-center justify-between border-b border-border pb-4 text-xs uppercase tracking-[.13em] text-muted">
                    <span>Your placement</span>
                    <strong className="text-[27px] text-accent tabular">#{targetRank}</strong>
                  </div>

                  {existing ? (
                    <div className="my-4 text-sm leading-relaxed text-muted">
                      <p>
                        You&apos;re already on the Wall at #{existing.rank} with {formatPrice(existing.amount_paid)}.
                        Move to #{targetRank} for {formatPrice(checkoutCents)} more.
                      </p>
                      <p className="mt-2">This upgrade changes Wall rank only.</p>
                    </div>
                  ) : (
                    <ul className="my-4 space-y-4 text-[13px]">
                      <Benefit title={`${hours} homepage hour${hours === 1 ? "" : "s"}`}>
                        {chosenHourIso ? (
                          <>
                            {slotId ? "Your chosen hour" : "The next open hour"} — {" "}
                            <LocalTime iso={chosenHourIso} mode="when" />
                          </>
                        ) : (
                          "Every visitor sees only your product"
                        )}
                      </Benefit>
                      <Benefit title={`Permanent Wall rank #${targetRank}`}>
                        Your link stays listed forever
                      </Benefit>
                      <Benefit title="Live click tracking">
                        See exactly what your hour delivered
                      </Benefit>
                    </ul>
                  )}

                  {error ? (
                    <p role="alert" className="mb-3 rounded-[13px] bg-danger-soft px-4 py-3 text-sm text-danger">
                      {error}
                    </p>
                  ) : null}

                  <div className="flex items-baseline justify-between border-t border-border py-4 text-sm text-muted">
                    <span>
                      {existing ? "Upgrade" : `${hours} × ${formatPrice(effectiveCents)}`}
                    </span>
                    <strong className="text-3xl text-foreground tabular">{formatPrice(checkoutCents)}</strong>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !url.trim() || belowMinimum || !isValidUpgrade}
                    className="flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-accent font-extrabold text-accent-ink transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {submitting ? "Starting checkout…" : "Continue to pay"} {formatPrice(checkoutCents)} <ArrowIcon />
                  </button>
                  <small className="mt-2.5 block text-center text-faint">
                    {url.trim()
                      ? "Secure checkout · no account needed"
                      : "Paste your product URL to continue"}
                  </small>
                </aside>
              </form>
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
}

function PanelRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[150px_1fr] sm:gap-5">
      <span className="flex justify-between text-[13px] font-semibold sm:flex-col sm:gap-1">
        <span>{label}</span>
        <small className="font-normal text-faint">{hint}</small>
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Benefit({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <i className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/10 not-italic text-accent">
        ✓
      </i>
      <span>
        <b>{title}</b>
        <small className="block text-faint">{children}</small>
      </span>
    </li>
  );
}

function hostOf(raw: string): string {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "your page";
  }
}
