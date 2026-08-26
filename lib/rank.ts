/** A newly completed bid is placed after existing equal bids. */
export function projectedRankForBid(existingBids: readonly number[], targetBidCents: number): number {
  return existingBids.filter((bid) => bid >= targetBidCents).length + 1;
}
