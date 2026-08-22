/** How many entries fit on one page of the Wall before it paginates. */
export const WALL_PAGE_SIZE = 50;

/** How many amounts the checkout forms get for their live rank readout. */
export const WALL_RANK_SAMPLE = 500;

/**
 * Where an amount would land on the Wall if someone paid it now. Pure and
 * dependency-free so the checkout form can run it on every keystroke without a
 * round trip.
 *
 * `amounts` must be descending. The Wall breaks ties in favour of whoever paid first,
 * so every entry already sitting at this amount is ahead of a buyer arriving at it --
 * matching the top amount does not take the top spot, beating it by a cent does.
 */
export function rankForAmount(amounts: number[], amount: number): number {
  // First index holding strictly less than `amount`; everything before it is ahead.
  let lo = 0;
  let hi = amounts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (amounts[mid] >= amount) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/**
 * The rank as a label. Past the end of the list we only know the buyer is somewhere
 * below it, so say so rather than inventing a number the server would disagree with.
 */
export function rankLabel(amounts: number[], amount: number, capped: boolean): string {
  const rank = rankForAmount(amounts, amount);
  return capped && rank > amounts.length ? `#${amounts.length}+` : `#${rank}`;
}
