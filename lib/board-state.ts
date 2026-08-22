import { SILENT_HOURS_BEFORE_DECAY, applyDecay, effectiveFloor, formatPrice } from "./pricing";
import type { Board } from "./slots";
import { currentHourStart, nextPurchasableHour } from "./time";

/**
 * What the header and the buy section say about the next price move. Derived in one
 * place so the two never disagree.
 */
export type DropState =
  /** On the ratcheted floor. Nothing left to give back, however long the silence runs. */
  | { kind: "floor" }
  /** Quiet, but not yet expensively so. `hoursRemaining` more free hours to go. */
  | { kind: "quiet"; hoursRemaining: number }
  /** The run is long enough that the next silent hour costs 5%. */
  | { kind: "drop"; nextPriceLabel: string; atIso: string };

export function deriveDropState(board: Board, now: Date = new Date()): DropState {
  const allTimeHigh = Math.max(board.all_time_high_floor, board.price);
  if (board.price <= effectiveFloor(allTimeHigh)) return { kind: "floor" };

  // silent_hours counts hours that have fully elapsed. A sale inside the hour currently
  // in progress means that hour will not be silent either, so the run is already broken.
  const lastSale = board.last_sale_at ? new Date(board.last_sale_at) : null;
  const pending = lastSale && lastSale >= currentHourStart(now) ? 0 : board.silent_hours;

  if (pending < SILENT_HOURS_BEFORE_DECAY) {
    return { kind: "quiet", hoursRemaining: SILENT_HOURS_BEFORE_DECAY - pending };
  }

  return {
    kind: "drop",
    nextPriceLabel: formatPrice(applyDecay(board.price, allTimeHigh)),
    atIso: nextPurchasableHour(now).toISOString(),
  };
}

/** "2 more quiet hours" / "1 more quiet hour". */
export function quietHoursLabel(hours: number): string {
  return `${hours} more quiet ${hours === 1 ? "hour" : "hours"}`;
}
