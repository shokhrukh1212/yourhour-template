"use client";

import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { useClicks } from "@/components/ClicksProvider";
import { Logo } from "@/components/Logo";
import { useVisitors } from "@/components/VisitorsProvider";

export function SiteHeader({ buyer = false, statsUrl }: { buyer?: boolean; statsUrl?: string }) {
  const { deliveredTotal } = useClicks();
  const visitorTotal = useVisitors();

  return (
    <header className="border-b border-border bg-background/90 backdrop-blur-2xl">
      <div className="site-header-shell flex min-h-[72px] items-center justify-between gap-1.5 py-3 min-[360px]:gap-3">
        <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-[14px] font-bold tracking-[-.035em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent min-[360px]:gap-2.5 min-[360px]:text-[17px]">
          <Logo className="h-[23px] w-[23px] min-[360px]:h-[27px] min-[360px]:w-[27px]" />
          <span>yourhour<span className="hidden text-faint min-[430px]:inline">.lol</span></span>
        </Link>
        <div className="flex min-w-0 items-center justify-end gap-3 sm:gap-6">
          <div className="flex shrink-0 items-baseline gap-1 whitespace-nowrap text-[7.5px] leading-none tracking-[-.025em] text-faint min-[360px]:gap-1.5 min-[360px]:text-[9px] min-[430px]:gap-2.5 min-[430px]:text-[10px] min-[560px]:gap-3 min-[560px]:text-[11px]">
            <span aria-label={`${visitorTotal.toLocaleString()} visitors since launch`}><b className="text-[10.5px] font-semibold text-muted tabular min-[360px]:text-[12px] min-[560px]:text-[14px]">{visitorTotal.toLocaleString()}</b> visitors since launch</span>
            <span aria-hidden="true">·</span>
            <span aria-label={`${deliveredTotal.toLocaleString()} clicks so far`}><b className="text-[10.5px] font-semibold text-muted tabular min-[360px]:text-[12px] min-[560px]:text-[14px]">{deliveredTotal.toLocaleString()}</b> clicks so far</span>
          </div>
          {!buyer ? (
            <>
              {statsUrl ? <a href={statsUrl} target="_blank" rel="noopener" className="hidden text-sm text-muted hover:text-foreground md:block">Stats</a> : null}
              <a href="#wall" className="hidden text-sm text-muted hover:text-foreground lg:block">Leaderboard</a>
              <Link href="/get-clicks" className="hidden min-h-11 items-center gap-2 rounded-[13px] bg-accent px-4 text-sm font-extrabold text-accent-ink transition hover:-translate-y-0.5 sm:inline-flex">Get clicks <ArrowIcon /></Link>
            </>
          ) : (
            <>{statsUrl ? <a href={statsUrl} target="_blank" rel="noopener" className="hidden text-sm text-muted hover:text-foreground md:block">Stats</a> : null}<Link href="/" className="hidden text-sm text-muted hover:text-foreground sm:block">See what&apos;s live</Link></>
          )}
        </div>
      </div>
    </header>
  );
}
