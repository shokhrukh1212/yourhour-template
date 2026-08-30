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
import { getAllBidCents, getLeaderboard, getLeaderboardSummary, getTopListing } from "@/lib/leaderboard";
import { nextBidCents } from "@/lib/pricing";
import { getVisitorTotal } from "@/lib/visitors";

export const dynamic = "force-dynamic";

function display(item: Awaited<ReturnType<typeof getTopListing>> & {}): DisplayListing {
  return { id: item.id, url: item.url, productName: item.product_name, pitch: item.pitch, iconUrl: item.icon_url, bidCents: item.bid_cents, verifiedClicks: item.verified_clicks, rank: item.rank };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ purchase?: string; target?: string }> }) {
  const params = await searchParams;
  const [top, rows, summary, existingBids, visitorTotal] = await Promise.all([
    getTopListing(),
    getLeaderboard(5),
    getLeaderboardSummary(),
    getAllBidCents(),
    getVisitorTotal(),
  ]);
  const minimum = nextBidCents(top?.bid_cents ?? null);
  const requested = Number(params.target);
  const hasRequestedBid = Number.isSafeInteger(requested) && requested >= 300 && requested % 100 === 0;
  const initialBid = hasRequestedBid ? requested : minimum;
  const purchaseIntent = /^[0-9a-f-]{36}$/i.test(params.purchase ?? "") ? params.purchase! : null;
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
          <div className="site-shell page-content">
            {top ? (
              <section className="top-grid">
                <MetaViewContent valueCents={minimum} />
                <FeaturedProduct listing={display(top)} />
                <ClaimPanel />
                <OvertakeTrail />
              </section>
            ) : <EmptyHero />}
            <Leaderboard initial={rows.map(display)} total={summary.count} />
          </div>
          {top ? <MobileClaimBar /> : null}
        </OvertakeProvider>
      </BidProvider>
    </main>
  );
}
