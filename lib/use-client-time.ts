"use client";

import { useSyncExternalStore } from "react";

/**
 * Timezone-dependent output can't be rendered on the server without a hydration
 * mismatch, and a countdown has to retick every second. Both are external state, so
 * they go through useSyncExternalStore rather than setState-inside-an-effect, which
 * would trigger a cascading render on every tick.
 */

// --- "are we on the client yet" -------------------------------------------------

const noopSubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, clientSnapshot, serverSnapshot);
}

// --- a shared once-per-second clock ---------------------------------------------

let cachedNow = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      cachedNow = Date.now();
      for (const listener of listeners) listener();
    }, 1000);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

// Must return a stable value between ticks, or React re-renders in a loop.
function getClockSnapshot(): number {
  if (cachedNow === 0) cachedNow = Date.now();
  return cachedNow;
}

function getClockServerSnapshot(): number {
  return 0;
}

/** Milliseconds since epoch, updated once a second. Returns 0 during SSR. */
export function useNow(): number {
  return useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockServerSnapshot);
}
