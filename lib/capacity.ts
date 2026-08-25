import { MAX_CLICKS } from "./pricing";

/** The supply cap must always be large enough to admit the largest advertised order. */
export function effectiveOutstandingCap(configuredCap: number): number {
  return Math.max(MAX_CLICKS, configuredCap);
}

export function canReservePurchase(
  configuredCap: number,
  outstandingClicks: number,
  heldClicks: number,
  requestedClicks: number,
): boolean {
  return outstandingClicks + heldClicks + requestedClicks <= effectiveOutstandingCap(configuredCap);
}
