"use client";

import { quietHoursLabel, type DropState } from "@/lib/board-state";
import { Countdown } from "./Countdown";

/**
 * The live board price and what happens to it next. The hero's countdown owns the
 * hour-rollover reload, so this one never triggers it.
 */
export function PriceStrip({
  priceLabel,
  drop,
}: {
  priceLabel: string;
  drop: DropState;
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="font-medium text-accent tabular">{priceLabel}</span>
      <span className="hidden text-faint sm:inline" aria-hidden="true">
        ·
      </span>
      <span className="hidden text-muted sm:inline">
        {drop.kind === "floor" ? (
          "floor price — can't go lower"
        ) : drop.kind === "quiet" ? (
          `no drop for ${quietHoursLabel(drop.hoursRemaining)}`
        ) : (
          <>
            drops to <span className="text-foreground">{drop.nextPriceLabel}</span> in{" "}
            <Countdown endsAtIso={drop.atIso} suffix="" reloadOnZero={false} />
          </>
        )}
      </span>
    </span>
  );
}
