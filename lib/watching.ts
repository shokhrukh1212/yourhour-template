import { config } from "./config";

/**
 * Live visitor count, read from Vemetric's REST API -- the same number the
 * dashboard shows next to the green dot on the Users card.
 *
 * Every browser polls /api/visitors every few seconds, so the result is cached
 * per instance: Vemetric only recomputes the live window every so often anyway,
 * and one upstream call per CACHE_MS keeps us far away from any rate limit.
 */
const CACHE_MS = 10_000;
const TIMEOUT_MS = 2_500;

let cached: { value: number | null; at: number } | null = null;
let inFlight: Promise<number | null> | null = null;

async function fetchWatching(): Promise<number | null> {
  if (!config.vemetric.apiKey) return null;
  try {
    const response = await fetch("https://api.vemetric.com/v1/analytics/query", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.vemetric.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ dateRange: "live", metrics: ["users"] }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = await response.json() as { data?: Array<{ metrics?: { users?: number } }> };
    const users = body.data?.[0]?.metrics?.users;
    return typeof users === "number" && Number.isFinite(users) ? Math.max(0, Math.round(users)) : null;
  } catch {
    // Analytics must never take the header down; the caller renders without it.
    return null;
  }
}

export async function getWatchingNow(): Promise<number | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  // Collapse concurrent misses into a single upstream request.
  inFlight ??= fetchWatching().finally(() => { inFlight = null; });
  const value = await inFlight;
  cached = { value, at: Date.now() };
  return value;
}
