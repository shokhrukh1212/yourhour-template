import type { Metadata } from "next";
import { BuyerFlow } from "@/components/BuyerFlow";
import { ClicksProvider } from "@/components/ClicksProvider";
import { Footer } from "@/components/Footer";
import { SiteHeader } from "@/components/SiteHeader";
import { TopClickedProducts } from "@/components/TopClickedProducts";
import { VisitorsProvider } from "@/components/VisitorsProvider";
import { Wall, type QueueCampaign } from "@/components/Wall";
import {
  estimateQueue,
  formatEta,
  getCampaignBySlug,
  getCampaignCount,
  getDeliveredLast24h,
  getDeliveredProof,
  getDeliveredTotal,
  getLeaderboardPage,
  getQueueWithLive,
  getRollingClicksPerHour,
  stripCampaignOwner,
} from "@/lib/campaigns";
import { jumpPrice } from "@/lib/pricing";
import { config } from "@/lib/config";
import { getVisitorTotal } from "@/lib/visitors";
import { WALL_PAGE_SIZE } from "@/lib/wall-rank";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feature your product. Pay only for valid visits.",
  description: "Feature your product on the YourHour homepage and pay only for valid visits. Visitors choose whether to open the featured product; undelivered visits are refunded.",
};

export default async function GetClicksPage({ searchParams }: { searchParams: Promise<{ wall?: string }> }) {
  const page = Math.max(1, Number((await searchParams).wall) || 1);
  const [deliveredTotal, deliveredLast24h, visitorTotal, proof, entries, campaignTotal, queue, rate, screenwar] = await Promise.all([
    getDeliveredTotal(),
    getDeliveredLast24h(),
    getVisitorTotal(),
    getDeliveredProof(),
    getLeaderboardPage(WALL_PAGE_SIZE, (page - 1) * WALL_PAGE_SIZE),
    getCampaignCount(),
    getQueueWithLive(),
    getRollingClicksPerHour(),
    getCampaignBySlug("screenwar"),
  ]);
  const estimates = estimateQueue(queue, rate);
  const publicQueue: QueueCampaign[] = queue.map((campaign) => ({
    ...stripCampaignOwner(campaign),
    eta: formatEta(estimates[campaign.id]?.complete ?? null),
  }));
  const highestPriority = Math.max(0, ...queue.filter((campaign) => campaign.status === "queued").map((campaign) => campaign.priority_cents));
  const rows = [...entries, ...proof, ...queue];
  const initialClicks = Object.fromEntries(rows.map((campaign) => [campaign.id, campaign.total_clicks_delivered]));
  const initialBonusClicks = Object.fromEntries(rows.map((campaign) => [campaign.id, campaign.bonus_clicks_delivered]));

  return (
    <VisitorsProvider initial={visitorTotal}>
      <ClicksProvider initial={{ deliveredTotal, deliveredLast24h, live: null, waiting: queue.filter((campaign) => campaign.status === "queued").length, clicks: initialClicks, bonusClicks: initialBonusClicks }} campaignIds={Object.keys(initialClicks)}>
        <main className="landing-page flex-1">
          <SiteHeader buyer statsUrl={config.vemetric.publicDashboardUrl} />
          <BuyerFlow screenwar={screenwar} />

        <section className="landing-shell grid gap-4 pb-24 md:grid-cols-2 md:pb-32" aria-labelledby="valid-click-heading">
          <article className="rounded-[24px] border border-border bg-surface p-6 sm:p-8">
            <span className="landing-eyebrow">Clear counting</span>
            <h2 id="valid-click-heading" className="mt-3 text-[clamp(32px,4vw,48px)] font-normal leading-none tracking-[-.05em]">What counts as a valid visit?</h2>
            <p className="mt-5 leading-relaxed text-muted">A valid visit is recorded when an eligible visitor opens your product from YourHour. Repeat visits from the same visitor, obvious bots and the product owner&apos;s own visits are excluded.</p>
          </article>
          <article id="how" className="rounded-[24px] border border-violet/30 bg-[linear-gradient(145deg,rgba(155,124,255,.09),transparent_55%),#101219] p-6 sm:p-8">
            <span className="landing-eyebrow">How it works</span>
            <ol className="mt-5 space-y-5">
              <Step number="1" title="Submit your product">We read the page and show you exactly what visitors will see.</Step>
              <Step number="2" title="Choose clicks and pay">Choose 50 for $10, or customize from 25 for $5. Checkout is secure and no account is required.</Step>
              <Step number="3" title="Watch delivery live">Your counter updates as valid visitors open your product.</Step>
            </ol>
          </article>
        </section>

        <TopClickedProducts products={proof} />
        <div className="landing-shell mb-28 border-t border-border" aria-hidden="true" />
        <Wall entries={entries} page={page} totalPages={Math.max(1, Math.ceil(campaignTotal / WALL_PAGE_SIZE))} total={campaignTotal} queue={publicQueue} ownedCampaignIds={[]} jumpPriceCents={jumpPrice(highestPriority)} basePath="/get-clicks" />

        <section className="landing-shell relative mb-8 overflow-hidden rounded-[28px] border border-violet/30 bg-[radial-gradient(circle_at_50%_130%,rgba(155,124,255,.3),transparent_45%),#101219] px-6 py-20 text-center">
          <span className="landing-eyebrow">Featured product placement</span>
          <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(40px,6vw,70px)] font-normal leading-[.95] tracking-[-.06em]">Pay only for the visits that happen.</h2>
          <a href="#buyer-heading" className="mt-7 inline-flex min-h-14 items-center justify-center rounded-[15px] bg-accent px-7 font-extrabold text-accent-ink">Feature your product — from $5</a>
        </section>
          <Footer />
        </main>
      </ClicksProvider>
    </VisitorsProvider>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <li className="grid grid-cols-[36px_1fr] gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-accent/10 text-xs font-extrabold text-accent">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm leading-relaxed text-muted">{children}</p></div></li>;
}
