"use client";

import { ArrowIcon } from "@/components/ArrowIcon";
import { useClicks } from "@/components/ClicksProvider";

/** An outbound product link that pulls the shared click counters forward once it is used. */
export function TrackedVisitLink({
  campaignId,
  productName,
  className,
}: {
  campaignId: string;
  productName: string;
  className?: string;
}) {
  const { notifyClick } = useClicks();
  return (
    <a
      href={`/r/${campaignId}`}
      target="_blank"
      rel="noopener"
      onClick={notifyClick}
      aria-label={`Visit ${productName} (opens in a new tab)`}
      className={className}
    >
      Visit <ArrowIcon className="h-3.5 w-3.5" />
    </a>
  );
}
