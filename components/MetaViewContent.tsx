"use client";

import { useEffect, useRef } from "react";
import { PLACEMENT_CONTENT_NAME, trackMetaEvent } from "@/lib/meta-pixel";

/**
 * ViewContent for the homepage placement itself. `value` is the price it currently
 * takes to hold it, which is the number an ad campaign optimises on. The listing that
 * happens to hold #1 is deliberately not identified: its URL was submitted by a buyer
 * and Meta has no need for it.
 */
export function MetaViewContent({ valueCents }: { valueCents: number }) {
  const reported = useRef(0);
  useEffect(() => {
    // Compared by value rather than by "first run", so an effect that runs twice for
    // one price (React Strict Mode, a remount) still reports one ViewContent.
    if (reported.current === valueCents) return;
    reported.current = valueCents;
    trackMetaEvent({
      name: "ViewContent",
      params: { value: valueCents / 100, currency: "USD", content_name: PLACEMENT_CONTENT_NAME },
    });
  }, [valueCents]);
  return null;
}
