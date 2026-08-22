"use client";

import { useMemo, useRef, useState } from "react";
import { vemetric } from "@vemetric/react";
import { quietHoursLabel, type DropState } from "@/lib/board-state";
import { peakTag } from "@/lib/peak";
import {
  BLOCK_OPTIONS,
  LAST_MINUTE_CENTS,
  STANDING_OPTIONS,
  blockMinimum,
  formatPrice,
  hourPrice,
  isLastMinute,
  standingMinimum,
} from "@/lib/pricing";
import { useNow } from "@/lib/use-client-time";
import { WALL_RANK_SAMPLE } from "@/lib/wall-rank";
import { AmountField, WallTopThree, parseAmountCents } from "./AmountField";
import { Countdown } from "./Countdown";
import { LocalTime } from "./LocalTime";

export type CalendarSlot = {
  id: string;
  startsAtIso: string;
  status: "open" | "reserved" | "sold" | "past";
  displayName: string | null;
  url: string | null;
  xHandle: string | null;
  gifterHandle: string | null;
  /** The last day of the standing run this hour belongs to, if it is part of one. */
  standingThroughIso: string | null;
  /** The hour already in progress, still inside its 15-minute selling window. */
  isLive?: boolean;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How many consecutive open hours start at `slotId`. A block is only offered if that
 * many hours are actually free, so the form never sends a checkout it knows will 409.
 */
function openRunFrom(openSlots: CalendarSlot[], slotId: string): number {
  const index = openSlots.findIndex((s) => s.id === slotId);
  if (index === -1) return 0;
  let run = 1;
  for (let i = index; i + 1 < openSlots.length; i++) {
    const gap =
      new Date(openSlots[i + 1].startsAtIso).getTime() -
      new Date(openSlots[i].startsAtIso).getTime();
    if (gap !== HOUR_MS) break;
    run++;
  }
  return run;
}

/**
 * Whether the same hour of the day is free on every one of the next `days` days.
 *
 * Only the first of those days is inside the 24-hour calendar, so this works from
 * `booked` -- every non-open hour in the next week, sent down by the server. An hour
 * with no row at all is free by definition: it has never been offered to anyone.
 */
function standingRunIsFree(booked: Set<string>, startsAtIso: string, days: number): boolean {
  const start = new Date(startsAtIso).getTime();
  for (let d = 1; d < days; d++) {
    if (booked.has(new Date(start + d * DAY_MS).toISOString())) return false;
  }
  return true;
}

export function ClaimBoard({
  slots,
  priceLabel,
  floorCents,
  bookedAhead,
  drop,
  visitorsPerHour,
  wallAmounts,
  wallTopThree,
}: {
  slots: CalendarSlot[];
  /** The cheapest hour actually for sale, which is what "from" in the heading means. */
  priceLabel: string;
  /** The stored board floor in cents. Every minimum is derived from it, per hour. */
  floorCents: number;
  /** Every non-open hour in the next week, so standing lengths can be offered honestly. */
  bookedAhead: string[];
  drop: DropState;
  visitorsPerHour: number;
  wallAmounts: number[];
  wallTopThree: { id: string; display_name: string | null; amount_paid: number }[];
}) {
  const openSlots = useMemo(() => slots.filter((s) => s.status === "open"), [slots]);
  const booked = useMemo(() => new Set(bookedAhead), [bookedAhead]);
  const [slotId, setSlotId] = useState<string>(openSlots[0]?.id ?? "");
  const [blockHours, setBlockHours] = useState(1);
  /** 0 means this is not a standing purchase. 3 or 7 when it is. */
  const [standingDays, setStandingDays] = useState(0);
  const [isGift, setIsGift] = useState(false);
  // null means "follow the minimum". Once the buyer types, their number is theirs --
  // including a number below the minimum, so they can type "12" one digit at a time.
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // 0 until hydration. Clearance depends on the wall clock, which the server cannot
  // render without a mismatch, so anything time-dependent waits for this. Before then
  // `now` is the epoch, which reads as "nothing is last-minute" -- the same thing the
  // pre-hydration placeholders below are already saying.
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const hydrated = nowMs > 0;

  const selected = openSlots.find((s) => s.id === slotId) ?? null;
  const selectedStart = useMemo(
    () => (selected ? new Date(selected.startsAtIso) : null),
    [selected],
  );

  // A block is only real if that many consecutive hours are actually open. Computed
  // from the calendar the page already has, so it re-evaluates as the hour changes
  // rather than offering three hours and failing at checkout.
  const openRun = useMemo(() => openRunFrom(openSlots, slotId), [openSlots, slotId]);

  const availableBlocks = BLOCK_OPTIONS.filter((b) => b.hours <= openRun);
  const availableStanding = useMemo(
    () =>
      selected
        ? STANDING_OPTIONS.filter((o) => standingRunIsFree(booked, selected.startsAtIso, o.days))
        : [],
    [booked, selected],
  );

  /** What this selection costs at minimum, given its shape and the hour it anchors to. */
  const minimumCents = useMemo(() => {
    if (!selectedStart) return floorCents;
    if (standingDays > 0) return standingMinimum(floorCents, selectedStart, standingDays);
    if (blockHours > 1) return blockMinimum(floorCents, selectedStart, blockHours);
    return hourPrice(floorCents, selectedStart, now);
  }, [selectedStart, standingDays, blockHours, floorCents, now]);

  // The field shows the minimum until the buyer takes it over. Deriving it rather than
  // seeding state means it re-prices itself when the hour, the shape or the tier
  // changes, instead of stranding a number from whatever was selected first.
  const amount = typedAmount ?? (minimumCents / 100).toFixed(2);
  const typedCents = parseAmountCents(amount);
  const belowMinimum = typedCents === null || typedCents < minimumCents;

  /**
   * Changing the shape changes the minimum. A buyer who deliberately typed MORE than
   * the new minimum keeps their number -- that number is the whole point of the input.
   * One that no longer clears it goes back to following the minimum.
   */
  function releaseAmountIfBelow(next: number) {
    const typed = typedAmount === null ? null : parseAmountCents(typedAmount);
    if (typed === null || typed < next) setTypedAmount(null);
  }

  function chooseBlock(hours: number) {
    setBlockHours(hours);
    setStandingDays(0);
    if (selectedStart) {
      releaseAmountIfBelow(
        hours > 1
          ? blockMinimum(floorCents, selectedStart, hours)
          : hourPrice(floorCents, selectedStart, now),
      );
    }
  }

  function chooseStanding(days: number) {
    setBlockHours(1);
    setStandingDays(days);
    if (selectedStart) releaseAmountIfBelow(standingMinimum(floorCents, selectedStart, days));
  }

  /** Picking a different hour can shorten the open run out from under the selection. */
  function chooseSlot(id: string) {
    setSlotId(id);
    const run = openRunFrom(openSlots, id);
    const slot = openSlots.find((s) => s.id === id);
    if (blockHours > run) {
      chooseBlock(1);
      return;
    }
    if (standingDays > 0 && slot && !standingRunIsFree(booked, slot.startsAtIso, standingDays)) {
      chooseBlock(1);
      return;
    }
    // A different hour can be a different tier, so the minimum moves even when the
    // shape does not.
    if (slot) {
      const start = new Date(slot.startsAtIso);
      releaseAmountIfBelow(
        standingDays > 0
          ? standingMinimum(floorCents, start, standingDays)
          : blockHours > 1
            ? blockMinimum(floorCents, start, blockHours)
            : hourPrice(floorCents, start, now),
      );
    }
  }

  function selectAndScroll(id: string) {
    chooseSlot(id);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // The server re-derives the minimum under the board lock and is what actually
    // decides; this only saves the buyer a round trip to be told the obvious.
    if (belowMinimum) {
      setError(`The minimum for that is ${formatPrice(minimumCents)}.`);
      return;
    }
    setSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload = {
      kind: "hour" as const,
      slotId: String(form.get("slotId") ?? ""),
      blockHours,
      standingDays,
      amount,
      url: String(form.get("url") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      // On a gift the recipient's handle is the one credited everywhere, so it takes
      // the place of the ordinary optional handle.
      xHandle: isGift ? "" : String(form.get("xHandle") ?? "").trim(),
      isGift,
      recipientHandle: isGift ? String(form.get("recipientHandle") ?? "").trim() : "",
      gifterHandle: isGift ? String(form.get("gifterHandle") ?? "").trim() : "",
    };

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { checkoutUrl?: string; error?: string };

      if (!res.ok || !json.checkoutUrl) {
        setError(json.error ?? "Could not start checkout. Try another hour.");
        setSubmitting(false);
        return;
      }
      vemetric.trackEvent("checkout_started", {
        eventData: { slotId: payload.slotId, blockHours, standingDays, amount: payload.amount },
      });
      window.location.href = json.checkoutUrl;
    } catch {
      setError("Network error. Try again.");
      setSubmitting(false);
    }
  }

  const upcoming = useMemo(() => slots.filter((s) => !s.isLive), [slots]);

  const shapeLabel =
    standingDays > 0
      ? `a standing hour — ${standingDays} days`
      : blockHours > 1
        ? `${blockHours} hours`
        : "this hour";

  return (
    <>
      <section id="claim" className="mx-auto w-full max-w-2xl px-6 py-16">
        <h2 className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">
          Own the next hour from{" "}
          <span className="text-accent">{priceLabel}</span>
        </h2>
        <p className="mt-3 text-center text-sm leading-relaxed text-muted">
          One base price. It rises 20% every time someone buys. Quiet hours only lower it
          after three in a row, and it never drops below half its all-time high. Prime
          hours cost 2x, dead hours cost less.
          <br />
          Pay the minimum, or pay more and rank higher on the Wall forever.
        </p>

        <p className="mt-4 text-center text-sm text-faint">
          <span aria-hidden="true">⏳</span>{" "}
          {drop.kind === "floor" ? (
            "Floor price — can't go lower"
          ) : drop.kind === "quiet" ? (
            `No drop for ${quietHoursLabel(drop.hoursRemaining)}`
          ) : (
            <>
              Drops to <span className="font-medium text-foreground">{drop.nextPriceLabel}</span> in{" "}
              <Countdown endsAtIso={drop.atIso} suffix="" reloadOnZero={false} />
            </>
          )}
        </p>

        {openSlots.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-border bg-surface p-6 text-center text-muted">
            Every hour on the board is taken. Check back when the calendar rolls forward.
          </p>
        ) : (
          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="mt-10 space-y-4 rounded-2xl border border-border bg-surface p-6 shadow-sm"
          >
            <div>
              <label htmlFor="slotId" className="block text-sm font-medium">
                Which hour
              </label>
              <div className="relative mt-1.5">
                <select
                  id="slotId"
                  name="slotId"
                  required
                  value={slotId}
                  onChange={(e) => chooseSlot(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-border bg-background px-4 py-3 pr-10 text-base focus:border-accent focus:outline-none"
                >
                  {openSlots.map((slot) => {
                    const startsAt = new Date(slot.startsAtIso);
                    // The tier is derived from a FIXED zone (US Eastern), so it is the
                    // same on the server and the client and can render immediately.
                    // A native <option> cannot be laid out, so it is appended with the
                    // same middle dot the header uses rather than right-aligned, and
                    // uppercased in the string because text-transform on an option is
                    // ignored by the native pickers on macOS and mobile.
                    const tier = peakTag(startsAt);
                    // The TIME is the visitor's own, which the server cannot know. It
                    // waits for hydration exactly as <LocalTime> does -- rendering it
                    // server-side would ship UTC and leave it there.
                    const when = hydrated
                      ? (slot.isLive ? "Right now — " : "") +
                        startsAt.toLocaleString([], {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "…";
                    return (
                      <option key={slot.id} value={slot.id}>
                        {when}
                        {tier ? `  ·  ${tier.toUpperCase()}` : ""}
                      </option>
                    );
                  })}
                </select>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
                >
                  <path
                    d="M5 7.5 10 12.5 15 7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            {availableBlocks.length > 1 || availableStanding.length > 0 ? (
            <div>
              <span className="block text-sm font-medium">How long</span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {availableBlocks.map((block) => (
                  <button
                    key={block.hours}
                    type="button"
                    onClick={() => chooseBlock(block.hours)}
                    aria-pressed={standingDays === 0 && blockHours === block.hours}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                      standingDays === 0 && blockHours === block.hours
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-border text-muted hover:border-accent"
                    }`}
                  >
                    {block.hours === 1 ? "1 hour" : `${block.hours} in a row`}
                    {selectedStart ? (
                      <span className="ml-1.5 tabular text-faint">
                        {formatPrice(
                          block.hours === 1
                            ? hydrated
                              ? hourPrice(floorCents, selectedStart, now)
                              : blockMinimum(floorCents, selectedStart, 1)
                            : blockMinimum(floorCents, selectedStart, block.hours),
                        )}
                      </span>
                    ) : null}
                  </button>
                ))}

                {availableStanding.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => chooseStanding(availableStanding[0].days)}
                    aria-pressed={standingDays > 0}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                      standingDays > 0
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-border text-muted hover:border-accent"
                    }`}
                  >
                    Standing hour
                  </button>
                ) : null}
              </div>

              {standingDays > 0 && selected ? (
                <div className="mt-3 rounded-xl border border-border bg-background px-5 py-4">
                  <span className="block text-sm">
                    Own{" "}
                    <span className="font-medium">
                      <LocalTime iso={selected.startsAtIso} />
                    </span>{" "}
                    every day for:
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {availableStanding.map((option) => (
                      <button
                        key={option.days}
                        type="button"
                        onClick={() => chooseStanding(option.days)}
                        aria-pressed={standingDays === option.days}
                        className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                          standingDays === option.days
                            ? "border-accent bg-accent-soft font-medium text-accent"
                            : "border-border text-muted hover:border-accent"
                        }`}
                      >
                        {option.days} days
                        {selectedStart ? (
                          <span className="ml-1.5 tabular text-faint">
                            {formatPrice(standingMinimum(floorCents, selectedStart, option.days))}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="mt-1.5 text-xs text-faint">
                {standingDays > 0
                  ? `The same hour, ${standingDays} days running. Each day gets its own launch post.`
                  : blockHours > 1
                    ? `${blockHours} hours back to back, starting at the hour above. Each one gets its own launch post.`
                    : "Consecutive hours, or the same hour every day. Both are cheaper per hour than buying them one at a time."}
              </p>
            </div>
            ) : null}

            <WallTopThree top={wallTopThree} />

            <AmountField
              id="amount"
              value={amount}
              onChange={setTypedAmount}
              minimumCents={minimumCents}
              wallAmounts={wallAmounts}
              capped={wallAmounts.length >= WALL_RANK_SAMPLE}
            />

            <div>
              <label htmlFor="url" className="block text-sm font-medium">
                {isGift ? "Their URL" : "Your URL"}
              </label>
              <input
                id="url"
                name="url"
                type="url"
                required
                placeholder="https://yourproduct.com"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-faint">
                We&apos;ll pull {isGift ? "their" : "your"} product name and pitch from this page.
              </p>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-faint">
                For your receipt and a reminder 30 minutes before the hour starts.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background px-5 py-4">
              <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={isGift}
                  onChange={(e) => setIsGift(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent,#ff7a45)]"
                />
                I&apos;m buying this for someone else
              </label>

              {isGift ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="recipientHandle" className="block text-sm font-medium">
                      Their X handle
                    </label>
                    <input
                      id="recipientHandle"
                      name="recipientHandle"
                      type="text"
                      required
                      placeholder="@theirproduct"
                      maxLength={16}
                      className="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-base focus:border-accent focus:outline-none"
                    />
                    <p className="mt-1.5 text-xs text-faint">
                      The account the launch post credits with the hour.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="gifterHandle" className="block text-sm font-medium">
                      Your X handle
                    </label>
                    <input
                      id="gifterHandle"
                      name="gifterHandle"
                      type="text"
                      required
                      placeholder="@you"
                      maxLength={16}
                      className="mt-1.5 w-full rounded-xl border border-border bg-surface px-4 py-3 text-base focus:border-accent focus:outline-none"
                    />
                    <p className="mt-1.5 text-xs text-faint">
                      So we can credit you for the gift, on the post and on their page.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            {isGift ? null : (
              <div>
                <label htmlFor="xHandle" className="block text-sm font-medium">
                  X handle <span className="text-faint">(optional)</span>
                </label>
                <input
                  id="xHandle"
                  name="xHandle"
                  type="text"
                  placeholder="@yourproduct"
                  maxLength={16}
                  className="mt-1.5 w-full rounded-xl border border-border bg-background px-4 py-3 text-base focus:border-accent focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-faint">
                  We&apos;ll mention this account in the launch post.
                </p>
              </div>
            )}

            {error ? (
              <p role="alert" className="rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
                {error}
              </p>
            ) : null}

            <div className="space-y-4 rounded-xl border border-border bg-background p-5 text-sm leading-relaxed">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
                  What you&apos;re buying
                </h3>
                <p className="mt-2 text-muted">
                  The whole homepage for{" "}
                  {standingDays > 0
                    ? `one hour a day, ${standingDays} days running`
                    : blockHours === 1
                      ? "60 minutes"
                      : `${blockHours} hours`}
                  . An announcement from our X account
                  {standingDays > 0 || blockHours > 1 ? " for each hour" : ""}. A live click
                  counter. A permanent page and a shareable card that stay up forever, and a
                  spot on The Wall ranked by what you paid.
                  {isGift
                    ? " The page, the post and the Wall entry all name the recipient — and credit you as the person who paid."
                    : ""}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
                  What you&apos;re not buying
                </h3>
                <p className="mt-2 text-muted">
                  Traffic.{" "}
                  {visitorsPerHour >= 1
                    ? `This site gets about ${visitorsPerHour.toLocaleString()} ${
                        visitorsPerHour === 1 ? "visitor" : "visitors"
                      } an hour right now.`
                    : "This site gets almost no traffic right now."}{" "}
                  We&apos;re not going to pretend otherwise. The hour is worth what you make
                  it worth — bring your own people and it becomes a launch moment.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-accent px-6 py-4 text-lg font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? "Starting checkout…"
                : `Claim ${shapeLabel} — ${formatPrice(typedCents ?? minimumCents)}`}
            </button>
            <p className="text-center text-xs text-faint">
              The floor is held for 10 minutes.
            </p>
          </form>
        )}
      </section>

      <section className="mx-auto w-full max-w-2xl px-6 pb-16">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-faint">
          Next {upcoming.length} hours
        </h3>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {upcoming.map((slot) => {
            const startsAt = new Date(slot.startsAtIso);
            const clearance = hydrated && slot.status === "open" && isLastMinute(startsAt, now);
            const isStanding = slot.status === "sold" && slot.standingThroughIso !== null;
            const tag = peakTag(startsAt);

            return (
              <li
                key={slot.id}
                className={`flex items-center justify-between gap-4 px-5 py-3.5 ${
                  isStanding
                    ? "border-l-2 border-accent bg-accent-soft/60"
                    : slot.status === "sold"
                      ? "bg-accent-soft"
                      : clearance
                        ? "bg-accent-soft/40"
                        : ""
                }`}
              >
                <LocalTime iso={slot.startsAtIso} className="text-sm font-medium tabular" />

                {slot.status === "open" ? (
                  <div className="flex items-center gap-3">
                    {clearance ? (
                      <span className="rounded-full border border-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
                        Last minute {formatPrice(LAST_MINUTE_CENTS)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted">
                        Open —{" "}
                        <span className="font-medium text-foreground tabular">
                          {/* Time-dependent, so it waits for hydration rather than
                              rendering a price the server and client disagree about. */}
                          {hydrated ? formatPrice(hourPrice(floorCents, startsAt, now)) : " "}
                        </span>
                        {tag ? (
                          <span className="ml-2 text-xs uppercase tracking-[0.1em] text-faint">
                            {tag}
                          </span>
                        ) : null}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => selectAndScroll(slot.id)}
                      className="rounded-full border border-accent px-4 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
                    >
                      Claim
                    </button>
                  </div>
                ) : isStanding ? (
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="rounded-full border border-accent px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-accent">
                      Standing
                    </span>
                    <span className="text-muted">
                      held by{" "}
                      <a
                        href={`/r/${slot.id}`}
                        target="_blank"
                        rel="noopener"
                        className="font-semibold text-foreground underline decoration-accent/50 underline-offset-4 transition-colors hover:text-accent"
                      >
                        {slot.xHandle ?? slot.displayName ?? "a product"}
                      </a>{" "}
                      through <LocalTime iso={slot.standingThroughIso!} mode="date" />
                    </span>
                  </div>
                ) : slot.status === "sold" && slot.url ? (
                  <div className="flex items-center gap-2.5 text-sm">
                    <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-white">
                      Booked
                    </span>
                    <a
                      href={`/r/${slot.id}`}
                      target="_blank"
                      rel="noopener"
                      onClick={() =>
                        vemetric.trackEvent("upcoming_slot_clicked", {
                          eventData: { slotId: slot.id },
                        })
                      }
                      className="font-semibold text-foreground underline decoration-accent/50 underline-offset-4 transition-colors hover:text-accent"
                    >
                      {slot.displayName ?? "View product"} <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                ) : (
                  <span className="text-sm text-muted">
                    Reserved — <span className="italic">{slot.displayName ?? "reserved"}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
