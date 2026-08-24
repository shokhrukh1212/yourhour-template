"use client";

import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";
import { useIsClient } from "@/lib/use-client-time";

export type CalendarSlot = {
  id: string;
  startsAtIso: string;
  status: "open" | "reserved" | "sold" | "past";
  displayName: string | null;
};

/** The next day of availability, using the visitor's own timezone. */
export function UpcomingHours({ slots }: { slots: CalendarSlot[] }) {
  if (slots.length === 0) return null;

  return (
    <section id="hours" className="landing-shell scroll-mt-40 pb-36">
      <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <span className="landing-eyebrow">Next {slots.length} hours</span>
          <h2 className="mt-3 text-[clamp(40px,5vw,66px)] font-normal leading-none tracking-[-.055em]">
            Pick your moment.
          </h2>
        </div>
        <div className="flex gap-5 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <i className="h-[7px] w-[7px] rounded-full bg-accent" aria-hidden="true" />
            Open
          </span>
          <span className="inline-flex items-center gap-2">
            <i className="h-[7px] w-[7px] rounded-full bg-violet" aria-hidden="true" />
            Booked
          </span>
        </div>
      </div>

      <ul className="grid grid-cols-2 overflow-hidden rounded-[22px] border border-border bg-surface-soft sm:grid-cols-4 lg:grid-cols-6">
        {slots.map((slot) => {
          const booked = slot.status === "sold" && slot.displayName;
          const held = slot.status === "reserved";
          return (
            <li
              key={slot.id}
              className={`landing-hour-cell min-h-[104px] ${
                booked ? "bg-violet/[.06]" : held ? "bg-white/[.025]" : ""
              }`}
            >
              {booked ? (
                <div className="flex h-full flex-col items-start justify-between p-[18px]">
                  <LocalTime iso={slot.startsAtIso} className="text-sm font-bold tabular" />
                <Link
                  href={`/r/${slot.id}`}
                  target="_blank"
                  className="max-w-full truncate text-sm text-[#b7a8ff] hover:text-accent"
                >
                  {slot.displayName}
                </Link>
                </div>
              ) : held ? (
                <div className="flex h-full flex-col items-start justify-between p-[18px]">
                  <LocalTime iso={slot.startsAtIso} className="text-sm font-bold tabular" />
                  <span
                    className="text-sm capitalize text-faint"
                    title="Another buyer is completing checkout. This hour will reopen if they do not pay."
                  >
                    Held
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("yourhour:select-hour", {
                        detail: { slotId: slot.id },
                      }),
                    )
                  }
                  className="flex h-full w-full flex-col items-start justify-between p-[18px] text-left text-sm text-accent transition hover:bg-accent/[.1] focus-visible:bg-accent/[.1] focus-visible:outline-none"
                  aria-label="Claim this open hour"
                >
                  <LocalTime iso={slot.startsAtIso} className="text-sm font-bold text-foreground tabular" />
                  Claim
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-right text-[11px] text-faint">
        Times shown in your local timezone <LocalTimezone />
      </p>
    </section>
  );
}

function LocalTimezone() {
  const isClient = useIsClient();
  if (!isClient) return null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone ? <>· {zone}</> : null;
}
