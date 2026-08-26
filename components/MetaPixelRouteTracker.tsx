"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackMetaPageView } from "@/lib/meta-pixel";

/**
 * Meta's base tag counts the PageView of the document it loads with. App Router
 * navigations swap the page without a document load, so those have to be sent
 * here -- skipping the first run, which the base tag already reported.
 */
export function MetaPixelRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams}`;
  // Seeded with the route the base tag reported, and compared by value rather than
  // by "is this the first run": an effect that runs twice for one route (React Strict
  // Mode, a remount) must still produce exactly one PageView.
  const reported = useRef(routeKey);
  useEffect(() => {
    if (reported.current === routeKey) return;
    reported.current = routeKey;
    trackMetaPageView();
  }, [routeKey]);
  return null;
}
