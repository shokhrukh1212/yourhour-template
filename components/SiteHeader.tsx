import Link from "next/link";
import type { DropState } from "@/lib/board-state";
import { Logo } from "./Logo";
import { PriceStrip } from "./PriceStrip";
import { VisitorCount } from "./VisitorCount";

export function SiteHeader({
  priceLabel,
  drop,
  visits,
  statsUrl,
}: {
  priceLabel: string;
  drop: DropState;
  visits: number;
  statsUrl?: string;
}) {
  return (
    <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 px-6 py-5 text-sm">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <Logo className="h-6 w-6" />
        <span>
          yourhour<span className="text-faint">.lol</span>
        </span>
      </Link>
      <nav className="flex items-center gap-3 text-muted sm:gap-5">
        <PriceStrip priceLabel={priceLabel} drop={drop} />
        <VisitorCount initialCount={visits} statsUrl={statsUrl} />
        <Link href="/rules" className="hover:text-accent">
          Rules
        </Link>
        <Link href="/about" className="hover:text-accent">
          About
        </Link>
      </nav>
    </header>
  );
}
