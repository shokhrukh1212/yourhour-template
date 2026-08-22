"use client";

import { useIsClient } from "@/lib/use-client-time";

/**
 * Renders a UTC instant in the visitor's own timezone. Spec section 6: the audience is
 * global and nobody should have to convert. The server has no timezone, so formatting
 * is held back until the client takes over.
 */
export function LocalTime({
  iso,
  mode = "time",
  className,
}: {
  iso: string;
  mode?: "time" | "range" | "datetime" | "date";
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
    else if (mode === "datetime")
      text = `${time(start)} ${date(start)}`;
    else text = time(start);
  }

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
