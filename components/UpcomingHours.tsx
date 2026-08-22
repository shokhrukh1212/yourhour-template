import Link from "next/link";
import { LocalTime } from "@/components/LocalTime";

export type CalendarSlot = {
  id: string;
  startsAtIso: string;
  status: "open" | "reserved" | "sold" | "past";
  displayName: string | null;
};

/**
 * What is booked over the next day.
 *
 * Secondary information, below the Wall, and deliberately price-free: hours are not
 * sold one at a time any more. A row here answers "is anything happening at 4pm", not
 * "what would 4pm cost me".
 */
export function UpcomingHours({ slots }: { slots: CalendarSlot[] }) {
  if (slots.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-2xl px-6 pb-24">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
        Next {slots.length} hours
      </h2>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
        {slots.map((slot) => {
          const booked = slot.status === "sold" && slot.displayName;
          return (
            <li
              key={slot.id}
              className={`flex items-center justify-between gap-4 px-5 py-4 ${
                booked ? "bg-accent-soft" : ""
              }`}
            >
              <LocalTime iso={slot.startsAtIso} className="text-sm font-medium tabular" />
              {booked ? (
                <Link
                  href={`/r/${slot.id}`}
                  className="min-w-0 truncate text-sm font-medium hover:text-accent"
                >
                  {slot.displayName} <span aria-hidden>↗</span>
                </Link>
              ) : (
                <span className="text-sm text-faint">
                  {slot.status === "reserved" ? "held" : "open"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
