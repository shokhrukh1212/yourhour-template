import { ClaimBoard, type CalendarSlot } from "@/components/ClaimBoard";
import { LiveHour, type LiveHourData } from "@/components/LiveHour";
import { SiteHeader } from "@/components/SiteHeader";
import { Wall } from "@/components/Wall";
import { deriveDropState } from "@/lib/board-state";
import { config } from "@/lib/config";
import { formatPrice, hourPrice } from "@/lib/pricing";
import { reconcileBoard } from "@/lib/reconcile";
import {
  getBoard,
  getBookedHoursAhead,
  getClaimableLiveSlot,
  getEncoreBuyer,
  getLiveSlot,
  getNextOpenSlot,
  getUpcomingSlots,
  getVisitsTotal,
  getVisitorsPerHour,
} from "@/lib/slots";
import { getBuyerTotalClicks, getWallAmounts, getWallCount, getWallPage } from "@/lib/wall";
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
    board,
    liveSlot,
    claimableLive,
    encore,
    upcoming,
    nextOpen,
    visits,
    perHour,
    wallEntries,
    wallTotal,
    wallAmounts,
    bookedAhead,
  ] = await Promise.all([
    getBoard(),
    getLiveSlot(),
    getClaimableLiveSlot(),
    getEncoreBuyer(),
    getUpcomingSlots(),
    getNextOpenSlot(),
    getVisitsTotal(),
    getVisitorsPerHour(),
    getWallPage(WALL_PAGE_SIZE, (wallPage - 1) * WALL_PAGE_SIZE),
    getWallCount(),
    getWallAmounts(),
    getBookedHoursAhead(),
  ]);

  const now = new Date();
  const hourStart = liveSlot ? new Date(liveSlot.starts_at) : currentHourStart(now);
  const isSold = Boolean(liveSlot && liveSlot.display_name);
  // The header badge stays on the stored floor: the drop countdown printed beside it
  // describes that number and nothing else.
  const priceLabel = formatPrice(board.price);
  const drop = deriveDropState(board, now);

  // The top of the Wall, so the checkout form can show what it takes to beat it.
  // Page 1 already holds it; on a later page it is one small extra read.
  const wallTopThree =
    wallPage === 1 ? wallEntries.slice(0, 3) : await getWallPage(3, 0);

  // The hour in progress is buyable for its first fifteen minutes, so it belongs at the
  // top of the list -- which also makes it the form's default selection.
  const calendarSlots: CalendarSlot[] = [
    ...(claimableLive ? [{ slot: claimableLive, isLive: true }] : []),
    ...upcoming.map((slot) => ({ slot, isLive: false })),
  ].map(({ slot, isLive }) => ({
    id: slot.id,
    startsAtIso: new Date(slot.starts_at).toISOString(),
    status: slot.status,
    displayName: slot.display_name,
    url: slot.url,
    isLive,
    xHandle: slot.x_handle,
    gifterHandle: slot.gifter_handle,
    standingThroughIso: slot.standing_through
      ? new Date(slot.standing_through).toISOString()
      : null,
  }));

  // "from" has to mean what it says. Under peak pricing and last-minute clearance the
  // cheapest hour on the board is rarely the stored floor -- it is usually the $1 hour
  // about to start -- so the headline quotes the cheapest hour actually for sale.
  const openPrices = calendarSlots
    .filter((s) => s.status === "open")
    .map((s) => hourPrice(board.price, new Date(s.startsAtIso), now));
  const fromCents = openPrices.length > 0 ? Math.min(...openPrices) : board.price;

  const liveData: LiveHourData = {
    slotId: isSold ? liveSlot!.id : null,
    startsAtIso: hourStart.toISOString(),
    endsAtIso: new Date(hourStart.getTime() + HOUR_MS).toISOString(),
    nowIso: now.toISOString(),
    displayName: isSold ? liveSlot!.display_name : null,
    url: isSold ? liveSlot!.url : null,
    pitch: isSold ? liveSlot!.pitch : null,
    // The buyer's whole rollup, exactly what their Wall card and permanent page show.
    // The hero used to print this hour's clicks alone, so the same product appeared
    // twice on one screen with two different numbers.
    clicks: isSold ? await getBuyerTotalClicks(liveSlot!.id) : 0,
    // What "Claim this hour" would actually charge. The live hour has already started,
    // so it is always inside the clearance window -- quoting the base floor here would
    // advertise a price the checkout does not ask for. When the live hour is past its
    // 15-minute window the button falls through to the form, so quote the form's number.
    priceLabel: formatPrice(
      claimableLive ? hourPrice(board.price, hourStart, now) : fromCents,
    ),
    encore,
    nextOpen: nextOpen
      ? {
          startsAtIso: new Date(nextOpen.starts_at).toISOString(),
          // That hour's real price -- tier and clearance included -- not the base floor.
          priceLabel: formatPrice(hourPrice(board.price, new Date(nextOpen.starts_at), now)),
        }
      : null,
  };

  return (
    <main className="relative flex-1">
      <SiteHeader
        priceLabel={priceLabel}
        drop={drop}
        visits={visits}
        statsUrl={config.vemetric.publicDashboardUrl}
      />
      <LiveHour data={liveData} />
      <ClaimBoard
        slots={calendarSlots}
        priceLabel={formatPrice(fromCents)}
        floorCents={board.price}
        bookedAhead={bookedAhead}
        drop={drop}
        visitorsPerHour={perHour}
        wallAmounts={wallAmounts}
        wallTopThree={wallTopThree}
      />
      <Wall
        entries={wallEntries}
        page={wallPage}
        totalPages={Math.max(1, Math.ceil(wallTotal / WALL_PAGE_SIZE))}
        total={wallTotal}
        wallAmounts={wallAmounts}
      />
      <footer className="border-t border-border px-6 py-10 text-center text-xs leading-relaxed text-faint">
        yourhour — twenty-four hours a day, one product at a time.
        <br />
        The Wall is permanent.
      </footer>
    </main>
  );
}
