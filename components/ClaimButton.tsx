"use client";

import { ArrowIcon } from "@/components/ArrowIcon";

export function ClaimButton({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("yourhour:focus-claim"))}
      className={className}
    >
      {children} <ArrowIcon />
    </button>
  );
}
