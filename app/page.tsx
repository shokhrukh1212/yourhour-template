import { ClaimBar, type OpenHour } from "@/components/ClaimBar";
import { LiveHour, type LiveHourData } from "@/components/LiveHour";
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
import { getWallAmounts, getWallCount, getWallPage } from "@/lib/wall";
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

  const [liveSlot, upcoming, nextOpen, visits, wallEntries, wallTotal, wallAmounts] =
    await Promise.all([
      getLiveSlot(),
      getUpcomingSlots(),
      getNextOpenSlot(),
      getVisitsTotal(),
      getWallPage(WALL_PAGE_SIZE, (wallPage - 1) * WALL_PAGE_SIZE),
      getWallCount(),
      getWallAmounts(),
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
    // What THIS hour has earned while it has been on screen. The Wall card for the same
    // product shows the lifetime rollup, which is a different and larger number -- the
    // labels say which is which.
    clicks: isSold ? liveSlot!.clicks : 0,
  };

  return (
    <main className="flex-1">
      <ClaimBar
        numberOneCents={numberOneCents}
        wallAmounts={wallAmounts}
        openHours={openHours}
        nextOpenIso={nextOpen ? new Date(nextOpen.starts_at).toISOString() : null}
        visits={visits}
        statsUrl={config.vemetric.publicDashboardUrl}
      />
      <LiveHour data={liveData} />
      <Wall
        entries={wallEntries}
        page={wallPage}
        totalPages={Math.max(1, Math.ceil(wallTotal / WALL_PAGE_SIZE))}
        total={wallTotal}
      />
      <UpcomingHours slots={calendarSlots} />
      <footer className="border-t border-border px-6 py-10 text-center text-xs leading-relaxed text-faint">
        yourhour — one product owns the homepage every hour.
        <br />
        The Wall is permanent.
      </footer>
    </main>
  );
}
