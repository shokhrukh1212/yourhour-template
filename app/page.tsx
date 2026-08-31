import { BidProvider } from "@/components/BidProvider";
import { ClaimPanel } from "@/components/ClaimPanel";
import { EmptyHero } from "@/components/EmptyHero";
import { FeaturedProduct, type DisplayListing } from "@/components/FeaturedProduct";
import { Leaderboard } from "@/components/Leaderboard";
import { MetaViewContent } from "@/components/MetaViewContent";
import { MobileClaimBar } from "@/components/MobileClaimBar";
import { OvertakeProvider, OvertakeTrail } from "@/components/OvertakeProvider";
import { PurchaseStatus } from "@/components/PurchaseStatus";
import { SiteHeader } from "@/components/SiteHeader";
import { SponsoredProducts, SponsorshipStatus } from "@/components/SponsoredProducts";
import { getAllBidCents, getLeaderboard, getLeaderboardSummary, getTopListing } from "@/lib/leaderboard";
import { nextBidCents } from "@/lib/pricing";
import { getVisitorTotal } from "@/lib/visitors";
import { getSponsorSlots } from "@/lib/sponsorship";

export const dynamic = "force-dynamic";

function display(item: Awaited<ReturnType<typeof getTopListing>> & {}): DisplayListing {
  return { id: item.id, url: item.url, productName: item.product_name, pitch: item.pitch, iconUrl: item.icon_url, bidCents: item.bid_cents, verifiedClicks: item.verified_clicks, rank: item.rank };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ purchase?: string; sponsorship?: string; target?: string }> }) {
  const params = await searchParams;
  const [top, rows, summary, existingBids, visitorTotal, sponsorSlots] = await Promise.all([
    getTopListing(),
    getLeaderboard(5),
    getLeaderboardSummary(),
    getAllBidCents(),
    getVisitorTotal(),
    getSponsorSlots(),
  ]);
  const minimum = nextBidCents(top?.bid_cents ?? null);
  const requested = Number(params.target);
  const hasRequestedBid = Number.isSafeInteger(requested) && requested >= 300 && requested % 100 === 0;
  const initialBid = hasRequestedBid ? requested : minimum;
  const purchaseIntent = /^[0-9a-f-]{36}$/i.test(params.purchase ?? "") ? params.purchase! : null;
  const sponsorshipIntent = /^[0-9a-f-]{36}$/i.test(params.sponsorship ?? "") ? params.sponsorship! : null;
  const sponsorNow = new Date().toISOString();
  return (
    <main className="site-page">
      <SiteHeader initialVisitors={visitorTotal} />
      <BidProvider
        initialBidCents={initialBid}
        initialMinimumBidCents={minimum}
        initialTopId={top?.id ?? null}
        existingBids={existingBids}
      >
        <OvertakeProvider topId={top?.id ?? null} topName={top?.product_name ?? null} hasPurchaseIntent={Boolean(purchaseIntent)}>
          <PurchaseStatus intentId={purchaseIntent} />
          <SponsorshipStatus sponsorshipId={sponsorshipIntent} />
          <div className="site-shell page-content">
            {top ? (
              <section className="homepage-grid top-grid">
                <MetaViewContent valueCents={minimum} />
                <div className="homepage-featured"><FeaturedProduct listing={display(top)} /></div>
                <div className="homepage-claim"><ClaimPanel /></div>
                <div className="homepage-sponsors">
                  <SponsoredProducts slots={sponsorSlots} nowIso={sponsorNow} suppressMobileDock={Boolean(purchaseIntent || sponsorshipIntent)} />
                </div>
                <div className="homepage-leaderboard"><Leaderboard initial={rows.map(display)} total={summary.count} /></div>
                <OvertakeTrail />
              </section>
            ) : (
              <>
                <EmptyHero />
                <SponsoredProducts slots={sponsorSlots} nowIso={sponsorNow} suppressMobileDock={Boolean(sponsorshipIntent)} />
                <Leaderboard initial={rows.map(display)} total={summary.count} />
              </>
            )}
          </div>
          {top ? <MobileClaimBar /> : null}
        </OvertakeProvider>
      </BidProvider>
    </main>
  );
}
