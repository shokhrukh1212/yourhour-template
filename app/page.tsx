import { ClaimBar, type OpenHour } from "@/components/ClaimBar";
import { ClaimButton } from "@/components/ClaimButton";
import { Footer } from "@/components/Footer";
import { VisitorsProvider } from "@/components/VisitorsProvider";
import { LiveHour, type LiveHourData } from "@/components/LiveHour";
import { TopClickedProducts } from "@/components/TopClickedProducts";
import { UpcomingHours, type CalendarSlot } from "@/components/UpcomingHours";
import { Wall } from "@/components/Wall";
import { config } from "@/lib/config";
import { numberOnePrice } from "@/lib/pricing";
import { reconcileBoard } from "@/lib/reconcile";
import {
  getLiveSlot,
  getNextOpenSlot,
  getUpcomingSlots,
  getVisitsTotal,
} from "@/lib/slots";
import {
  getLandingClickProof,
  getWallAmounts,
  getWallCount,
  getWallPage,
} from "@/lib/wall";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";
import { HOUR_MS, currentHourStart } from "@/lib/time";

// The board is live data; never serve a cached hour.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ wall?: string }>;
}) {
  const wallPage = Math.max(1, Number((await searchParams).wall) || 1);
  // Self-heal before reading. A late or dead cron can never show a finished hour as live.
  await reconcileBoard();

  const [
    liveSlot,
    upcoming,
    nextOpen,
    visits,
    wallEntries,
    wallTotal,
    wallAmounts,
    clickProof,
  ] = await Promise.all([
    getLiveSlot(),
    getUpcomingSlots(),
    getNextOpenSlot(),
    getVisitsTotal(),
    getWallPage(WALL_PAGE_SIZE, (wallPage - 1) * WALL_PAGE_SIZE),
    getWallCount(),
    getWallAmounts(),
    getLandingClickProof(),
  ]);

  const now = new Date();
  const hourStart = liveSlot ? new Date(liveSlot.starts_at) : currentHourStart(now);
  const isSold = Boolean(liveSlot && liveSlot.display_name);

  // The one price the site quotes, derived straight off the top of the Wall.
  const numberOneCents = numberOnePrice(wallAmounts[0] ?? null);

  const calendarSlots: CalendarSlot[] = upcoming.map((slot) => ({
    id: slot.id,
    startsAtIso: new Date(slot.starts_at).toISOString(),
    status: slot.status,
    displayName: slot.display_name,
  }));

  const openHours: OpenHour[] = calendarSlots
    .filter((slot) => slot.status === "open")
    .map(({ id, startsAtIso }) => ({ id, startsAtIso }));

  const liveData: LiveHourData = {
    slotId: isSold ? liveSlot!.id : null,
    startsAtIso: hourStart.toISOString(),
    endsAtIso: new Date(hourStart.getTime() + HOUR_MS).toISOString(),
    displayName: isSold ? liveSlot!.display_name : null,
    url: isSold ? liveSlot!.url : null,
    pitch: isSold ? liveSlot!.pitch : null,
    imageUrl: isSold ? liveSlot!.image_url : null,
    // What THIS hour has earned while it has been on screen. The Wall card for the same
    // product shows the lifetime rollup, which is a different and larger number -- the
    // labels say which is which.
    clicks: isSold ? liveSlot!.clicks : 0,
  };

  return (
    <main className="landing-page flex-1">
      <ClaimBar
        numberOneCents={numberOneCents}
        wallAmounts={wallAmounts}
        openHours={openHours}
        nextOpenIso={nextOpen ? new Date(nextOpen.starts_at).toISOString() : null}
        allTimeClicks={clickProof.allTimeClicks}
        statsUrl={config.vemetric.publicDashboardUrl}
      />

      {/* The cumulative visitor total registers this browser and stays current. */}
      <VisitorsProvider initial={visits}>
        <LiveHour
          data={liveData}
          visits={visits}
          wallTotal={wallTotal}
          topProduct={clickProof.topClickedProducts[0] ?? null}
        />
      </VisitorsProvider>

      <TopClickedProducts products={clickProof.topClickedProducts} />

      <section className="landing-shell mb-36 grid overflow-hidden rounded-[22px] border border-border bg-surface-soft md:grid-cols-3">
        <Step n="01" title="Paste your link">
          We pull in your product details.
        </Step>
        <Step n="02" title="Choose your hour">
          Pick the next opening or a time.
        </Step>
        <Step n="03" title="Own the homepage" last>
          All attention points to your product.
        </Step>
      </section>

      <Wall
        entries={wallEntries}
        page={wallPage}
        totalPages={Math.max(1, Math.ceil(wallTotal / WALL_PAGE_SIZE))}
        total={wallTotal}
        wallAmounts={wallAmounts}
      />
      <UpcomingHours slots={calendarSlots} />

      <section id="how" className="landing-shell scroll-mt-40 pb-36">
        <div className="mb-12 grid items-end gap-6 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
          <div>
            <span className="landing-eyebrow">Simple by design</span>
            <h2 className="mt-3 text-[clamp(40px,5vw,66px)] font-normal leading-[.97] tracking-[-.055em]">
              No ad manager.
              <br />
              No audience guessing.
            </h2>
          </div>
          <p className="max-w-md leading-relaxed text-muted">
            One payment buys a clear moment of attention and a permanent place in internet
            history.
          </p>
        </div>
        <div className="grid gap-3.5 md:grid-cols-3">
          <HowCard icon="60" title="Your hour is all yours">
            For 60 minutes, every visitor lands on your product—one pitch and one clear
            link.
          </HowCard>
          <HowCard icon="∞" title="The Wall is permanent">
            Your rank can move, but your listing and link stay visible forever.
          </HowCard>
          <HowCard icon="↗" title="The price stays honest">
            Rank #1 is always one whole dollar above the highest amount paid. It never
            falls while somebody waits.
          </HowCard>
        </div>
      </section>

      <section className="landing-shell relative mb-8 flex min-h-[430px] items-center justify-center overflow-hidden rounded-[30px] border border-violet/30 bg-[image:radial-gradient(circle_at_50%_140%,rgba(155,124,255,.35),transparent_46%)] bg-[#101219] px-6 py-24 text-center">
        <div
          className="pointer-events-none absolute bottom-[-430px] left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full border border-accent/[.16]"
          aria-hidden="true"
        />
        <div className="relative z-10">
          <span className="landing-eyebrow">Your launch deserves an audience</span>
          <h2 className="my-4 text-[clamp(46px,6vw,76px)] font-normal leading-none tracking-[-.06em]">
            Make the next hour yours.
          </h2>
          <p className="mb-7 text-lg text-muted">Paste your product. Pick a time. Own the homepage.</p>
          <ClaimButton className="inline-flex h-[50px] items-center gap-2.5 rounded-[14px] bg-accent px-5 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5">
            Claim #1
          </ClaimButton>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Step({
  n,
  title,
  children,
  last = false,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[106px] gap-4 border-border p-6 ${
        last ? "" : "border-b md:border-b-0 md:border-r"
      }`}
    >
      <span className="shrink-0 text-[11px] font-extrabold text-accent">{n}</span>
      <p className="m-0 text-sm">
        <b>{title}</b>
        <small className="mt-1 block text-muted">{children}</small>
      </p>
    </div>
  );
}

function HowCard({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className="min-h-[280px] rounded-[22px] border border-border bg-surface p-7">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-sm font-extrabold text-accent">
        {icon}
      </span>
      <h3 className="mb-2 mt-16 text-xl font-normal tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </article>
  );
}
