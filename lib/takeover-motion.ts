/**
 * Pure validation and replay protection for the client-side takeover moment.
 *
 * The checkout intent in the URL is only a lookup key. None of its values are
 * trusted here: a takeover exists only when the owner-only status endpoint says
 * the provider-verified order completed, currently ranks first, and its listing
 * also matches the authoritative board rendered by the server.
 */

export type CheckoutTakeoverStatus = {
  ready?: boolean;
  status?: string;
  orderId?: string | null;
  listingId?: string | null;
  productName?: string | null;
  amountPaidCents?: number | null;
  bidCents?: number | null;
  rank?: number | null;
};

export type VerifiedTakeover = {
  transactionId: string;
  listingId: string;
  productName: string;
  bidCents: number;
};

type ReplayStorage = Pick<Storage, "getItem" | "setItem">;

const replayedThisDocument = new Set<string>();

export function verifiedTakeoverFromStatus(
  result: CheckoutTakeoverStatus | null | undefined,
): VerifiedTakeover | null {
  if (!result?.ready || result.status !== "completed" || result.rank !== 1) return null;
  if (typeof result.orderId !== "string" || !result.orderId.trim()) return null;
  if (typeof result.listingId !== "string" || !result.listingId.trim()) return null;
  if (typeof result.amountPaidCents !== "number" || !Number.isFinite(result.amountPaidCents) || result.amountPaidCents <= 0) return null;
  if (typeof result.bidCents !== "number" || !Number.isFinite(result.bidCents) || result.bidCents <= 0) return null;
  return {
    transactionId: result.orderId,
    listingId: result.listingId,
    productName: result.productName?.trim() || "Your product",
    bidCents: result.bidCents,
  };
}

export function takeoverReplayKey(transactionId: string): string {
  return `yourhour:overtake:v1:${transactionId}`;
}

function browserStorage(): ReplayStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasReplayedTakeover(
  transactionId: string,
  storage: ReplayStorage | null = browserStorage(),
): boolean {
  const key = takeoverReplayKey(transactionId);
  if (replayedThisDocument.has(key)) return true;
  try {
    if (storage?.getItem(key)) {
      replayedThisDocument.add(key);
      return true;
    }
  } catch {
    // Storage may be blocked. The document-level marker still protects Strict Mode
    // effects and repeated status responses during this visit.
  }
  return false;
}

/**
 * Claims the one animation play only after both trust checks agree. A stale board
 * cannot consume the transaction, so a later authoritative refresh can still play.
 */
export function consumeVerifiedTakeover(
  result: CheckoutTakeoverStatus | null | undefined,
  authoritativeTopId: string | null,
  storage: ReplayStorage | null = browserStorage(),
): VerifiedTakeover | null {
  const takeover = verifiedTakeoverFromStatus(result);
  if (!takeover || takeover.listingId !== authoritativeTopId) return null;
  const key = takeoverReplayKey(takeover.transactionId);
  if (hasReplayedTakeover(takeover.transactionId, storage)) return null;
  try {
    storage?.setItem(key, "1");
  } catch {
    // The stable in-memory key remains the fallback when persistence is unavailable.
  }
  replayedThisDocument.add(key);
  return takeover;
}

/** Test seam for simulating a new document with the same persistent storage. */
export function resetTakeoverReplayMemory(): void {
  replayedThisDocument.clear();
}
