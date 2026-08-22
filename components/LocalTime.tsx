"use client";

import { useIsClient } from "@/lib/use-client-time";

/**
 * Renders a UTC instant in the visitor's own timezone. The audience is global and
 * nobody should have to convert. The server has no timezone, so formatting is held back
 * until the client takes over.
 *
 * Hours are stored on exact UTC hour boundaries, so a slot rendered here as "4:00 PM"
 * really does begin at 4:00 PM where the visitor is sitting.
 */
export function LocalTime({
  iso,
  mode = "time",
  className,
}: {
  iso: string;
  mode?: "time" | "range" | "datetime" | "date" | "when";
  className?: string;
}) {
  const isClient = useIsClient();

  let text = " "; // keeps layout stable for the frame before hydration
  if (isClient) {
    const start = new Date(iso);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const time = (d: Date) =>
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    const date = (d: Date) =>
      d.toLocaleDateString([], { month: "short", day: "numeric" });

    if (mode === "range") text = `${time(start)} – ${time(end)}`;
    else if (mode === "date") text = date(start);
    else if (mode === "datetime") text = `${time(start)} ${date(start)}`;
    else if (mode === "when") text = `${dayWord(start)}, ${time(start)}`;
    else text = time(start);
  }

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}

/**
 * "today" / "tomorrow" / a weekday, in the visitor's zone. A buyer needs to know which
 * day their hour lands on, and "Sun 4:00 PM" makes them work it out.
 */
function dayWord(at: Date): string {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((at.getTime() - midnight.getTime()) / (24 * 60 * 60 * 1000));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return at.toLocaleDateString([], { weekday: "long" });
}
