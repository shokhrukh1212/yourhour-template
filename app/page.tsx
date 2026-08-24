import { ClaimBar } from "@/components/ClaimBar";
import { ClaimButton } from "@/components/ClaimButton";
import { ClicksProvider } from "@/components/ClicksProvider";
import { Footer } from "@/components/Footer";
import { LiveHour } from "@/components/LiveHour";
import { TopClickedProducts } from "@/components/TopClickedProducts";
import { VisitorsProvider } from "@/components/VisitorsProvider";
import { Wall, type QueueCampaign } from "@/components/Wall";
import {
  estimateQueue,
  formatEta,
  getCampaignAmounts,
  getBonusCampaign,
  getCampaignCount,
  getDeliveredProof,
  getDeliveredToday,
  getDeliveredTotal,
  getLeaderboardPage,
  getLiveCampaign,
  getOwnedCampaignIds,
  getQueueWithLive,
  getRollingClicksPerHour,
  getSiteCapacity,
  stripCampaignOwner,
} from "@/lib/campaigns";
import { config } from "@/lib/config";
import { ownerHashFromCookies } from "@/lib/ownership";
import { jumpPrice, paidClicksForDisplay } from "@/lib/pricing";
import { getVisitorTotal } from "@/lib/visitors";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ wall?: string }> }) {
  const wallPage = Math.max(1, Number((await searchParams).wall) || 1);
  const ownerHash = await ownerHashFromCookies();
  const [live, bonus, queue, visitorTotal, deliveredTotal, deliveredToday, campaignTotal, entries, wallAmounts, proof, rate, capacity, ownedIds] = await Promise.all([
    getLiveCampaign(),
    getBonusCampaign(),
    getQueueWithLive(),
    getVisitorTotal(),
    getDeliveredTotal(),
    getDeliveredToday(),
    getCampaignCount(),
    getLeaderboardPage(WALL_PAGE_SIZE, (wallPage - 1) * WALL_PAGE_SIZE),
    getCampaignAmounts(),
    getDeliveredProof(),
    getRollingClicksPerHour(),
    getSiteCapacity(),
    getOwnedCampaignIds(ownerHash),
  ]);
  const featured = live ?? bonus;
  const isBonus = !live && Boolean(bonus);
  const estimates = estimateQueue(queue, rate);
  const publicQueue: QueueCampaign[] = queue.map((campaign) => ({
    ...stripCampaignOwner(campaign),
    eta: formatEta(estimates[campaign.id]?.complete ?? null),
  }));
  const waiting = queue.filter((campaign) => campaign.status === "queued").length;
  const highestPriority = Math.max(0, ...queue.filter((campaign) => campaign.status === "queued").map((campaign) => campaign.priority_cents));
  const clickRows = [...entries, ...proof, ...queue, ...(featured ? [featured] : [])];
  const initialClicks = Object.fromEntries(clickRows.map((campaign) => [campaign.id, campaign.clicks_delivered]));
  const initialBonusClicks = Object.fromEntries(clickRows.map((campaign) => [campaign.id, campaign.bonus_clicks]));

  return (
    <VisitorsProvider initial={visitorTotal}>
    <ClicksProvider initial={{ deliveredTotal, deliveredToday, live: featured ? { id: featured.id, clicksDelivered: featured.clicks_delivered, bonusClicks: featured.bonus_clicks, bonus: isBonus } : null, waiting, clicks: initialClicks, bonusClicks: initialBonusClicks }} campaignIds={Object.keys(initialClicks)}>
    <main className="landing-page flex-1">
      <ClaimBar wallAmounts={wallAmounts} statsUrl={config.vemetric.publicDashboardUrl} queueLength={queue.length} outstandingClicks={capacity.outstanding} rollingClicksPerHour={rate} />
      <LiveHour data={featured ? { id: featured.id, productName: featured.product_name, pitch: featured.pitch, url: featured.url, iconUrl: featured.icon_url, paidClicks: paidClicksForDisplay(featured), clicksDelivered: featured.clicks_delivered, bonusClicks: featured.bonus_clicks, bonus: isBonus } : null} />
      <TopClickedProducts products={proof} />

      <div className="landing-shell mb-36 border-t border-border" aria-hidden="true" />

      <Wall entries={entries} page={wallPage} totalPages={Math.max(1, Math.ceil(campaignTotal / WALL_PAGE_SIZE))} total={campaignTotal} queue={publicQueue} ownedCampaignIds={ownedIds} jumpPriceCents={jumpPrice(highestPriority)} />

      <section id="how" className="landing-shell scroll-mt-40 pb-36">
        <div className="mb-12 grid items-end gap-6 lg:grid-cols-[1.25fr_.75fr] lg:gap-14">
          <div><span className="landing-eyebrow">Simple by design</span><h2 className="mt-3 text-[clamp(40px,5vw,66px)] font-normal leading-[.97] tracking-[-.055em]">No ad manager.<br />No audience guessing.</h2></div>
          <p className="max-w-md leading-relaxed text-muted">One payment. A fixed price per click. You know exactly what you&apos;re getting before you pay.</p>
        </div>
        <div className="grid gap-3.5 md:grid-cols-3">
          <HowCard icon="20¢" title="A flat price per click">No CPM, no bidding, no auction. Twenty cents, every click, every time.</HowCard>
          <HowCard icon="✓" title="Delivered or refunded">Your product stays on the homepage until every click lands. If it takes more than seven days, you get the difference back.</HowCard>
          <HowCard icon="∞" title="The leaderboard is permanent">Your rank can move, but your listing and link stay visible forever.</HowCard>
        </div>
      </section>

      <section className="landing-shell relative mb-8 flex min-h-[430px] items-center justify-center overflow-hidden rounded-[30px] border border-violet/30 bg-[image:radial-gradient(circle_at_50%_140%,rgba(155,124,255,.35),transparent_46%)] bg-[#101219] px-6 py-24 text-center">
        <div className="pointer-events-none absolute bottom-[-430px] left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full border border-accent/[.16]" aria-hidden="true" />
        <div className="relative z-10"><span className="landing-eyebrow">Your launch deserves an audience</span><h2 className="my-4 text-[clamp(46px,6vw,76px)] font-normal leading-none tracking-[-.06em]">Twenty-five clicks. Five dollars.</h2><p className="mb-7 text-lg text-muted">Paste your product. Pick your clicks. We deliver them.</p><ClaimButton className="inline-flex h-[50px] items-center gap-2.5 rounded-[14px] bg-accent px-5 text-sm font-extrabold text-accent-ink shadow-[0_12px_36px_rgba(215,255,103,.14)] transition hover:-translate-y-0.5">Get clicks — from $5</ClaimButton></div>
      </section>
      <Footer />
    </main>
    </ClicksProvider>
    </VisitorsProvider>
  );
}

function HowCard({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return <article className="min-h-[280px] rounded-[22px] border border-border bg-surface p-7"><span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-sm font-extrabold text-accent">{icon}</span><h3 className="mb-2 mt-16 text-xl font-normal tracking-tight">{title}</h3><p className="text-sm leading-relaxed text-muted">{children}</p></article>;
}
