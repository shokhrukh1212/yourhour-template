"use client";

import { useEffect } from "react";

export const VISITOR_COUNT_EVENT = "yourhour:visitor-count";
export type VisitorCounts = { visitors?: number; watching?: number | null };

// Module scope, not a ref: "once per document" is what we mean, so a remount or
// React's development double-invoke must not register the same arrival twice. A
// browser with no cookie yet would otherwise mint two ids and count as two people.
let registered = false;

/**
 * Registers this browser against the cumulative visitor count, from every page.
 * The count used to be registered by SiteHeader, which only the homepage renders,
 * so anyone whose visit started on /rules, /about, /get-clicks or a profile page
 * was never counted. Mounted in the root layout, this covers all of them.
 *
 * The response carries the fresh totals, so it is broadcast for SiteHeader to pick
 * up rather than making the header wait out a poll interval to show the arrival.
 */
export function VisitorPing() {
  useEffect(() => {
    if (registered) return;
    registered = true;
    void (async () => {
      try {
        const response = await fetch("/api/visitors", { cache: "no-store" });
        if (!response.ok) return;
        const detail = await response.json() as VisitorCounts;
        window.dispatchEvent(new CustomEvent<VisitorCounts>(VISITOR_COUNT_EVENT, { detail }));
      } catch {
        // The count is cosmetic; a transient failure re-registers on the next page load.
      }
    })();
  }, []);
  return null;
}
