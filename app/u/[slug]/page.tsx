import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductLogo } from "@/components/ProductLogo";
import { CampaignClickProgress } from "@/components/CampaignClickProgress";
import { formatDeliveryDuration, getCampaignBySlug } from "@/lib/campaigns";
import { formatPrice, paidClicksForDisplay } from "@/lib/pricing";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await getCampaignBySlug(slug);
  if (!campaign) return { title: "Not found" };
  const title = `${campaign.product_name} on yourhour.lol`;
  return {
    title: campaign.product_name,
    description: campaign.pitch ?? undefined,
    openGraph: { type: "article", title, description: campaign.pitch ?? undefined, url: `/u/${campaign.slug}`, images: [{ url: `/card/${campaign.slug}.png`, width: 1200, height: 630, alt: title }] },
    twitter: { card: "summary_large_image", title, description: campaign.pitch ?? undefined, images: [`/card/${campaign.slug}.png`] },
  };
}

export default async function ProductPage({ params }: Params) {
  const campaign = await getCampaignBySlug((await params).slug);
  if (!campaign) notFound();
  const paidClicks = paidClicksForDisplay(campaign);
  const duration = formatDeliveryDuration(campaign.started_at, campaign.delivered_at);
  const status = campaign.status === "live" ? "Live" : campaign.status === "queued" ? "In queue" : "Delivered";
  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">← yourhour</Link>
        <div className="mt-10 flex items-center gap-4"><ProductLogo imageUrl={campaign.icon_url} productUrl={campaign.url} productName={campaign.product_name} className="h-14 w-14 rounded-[16px]" /><div><p className="text-[0.7rem] font-medium uppercase tracking-[0.3em] text-accent">{status}</p><h1 className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">{campaign.product_name}</h1></div></div>
        {campaign.pitch ? <p className="mt-5 text-lg leading-relaxed text-muted">{campaign.pitch}</p> : null}
        <a href={`/r/${campaign.id}`} target="_blank" rel="noopener" className="mt-8 inline-flex items-center gap-2 rounded-full bg-accent px-8 py-3.5 font-medium text-accent-ink transition-transform hover:scale-[1.03]">Visit {campaign.product_name} <span aria-hidden="true">↗</span></a>

        <section className="mt-10 rounded-[20px] border border-border bg-surface p-6">
          <CampaignClickProgress campaignId={campaign.id} initialDelivered={campaign.clicks_delivered} paidClicks={paidClicks} initialBonusClicks={campaign.bonus_clicks} />
          <dl className="mt-7 grid grid-cols-2 gap-5 border-t border-border pt-6 text-sm sm:grid-cols-3">
            <div><dt className="text-faint">Amount paid</dt><dd className="mt-1 text-lg font-semibold tabular">{formatPrice(campaign.amount_paid_cents)}</dd></div>
            <div><dt className="text-faint">Leaderboard</dt><dd className="mt-1 text-lg font-semibold tabular">#{campaign.rank}</dd></div>
            <div><dt className="text-faint">Status</dt><dd className="mt-1 text-lg font-semibold">{status}</dd></div>
          </dl>
          {duration ? <p className="mt-6 border-t border-border pt-5 text-sm text-muted">Completed {duration}.</p> : null}
        </section>

        <div className="mt-12 border-t border-border pt-6"><p className="text-sm text-faint">This product&apos;s listing, link and leaderboard rank stay visible permanently.</p><div className="mt-4 flex flex-wrap gap-3"><Link href="/#claim" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:border-accent hover:text-accent">Get your own clicks <span aria-hidden="true">→</span></Link><Link href="/#wall" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:border-accent hover:text-accent">See the leaderboard</Link></div></div>
      </div>
    </main>
  );
}
