import Link from "next/link";
import { notFound } from "next/navigation";
import { estimateQueue, formatEta, getCampaignBySlug, getQueueWithLive, getRollingClicksPerHour } from "@/lib/campaigns";
import { config } from "@/lib/config";
import { query } from "@/lib/db";
import { ownerHashFromCookies, ownerHashesMatch } from "@/lib/ownership";
import { formatPrice, jumpPrice } from "@/lib/pricing";
import { SuccessActions, WaitingForPayment } from "./SuccessActions";
import { XPurchaseEvent } from "./XPurchaseEvent";

export const dynamic = "force-dynamic";
export const metadata = { title: "You're in" };

type IntentRow = {
  status: string;
  mode: "purchase" | "jump";
  clicks_delta: number;
  expected_amount_cents: number;
  owner_token_hash: string | null;
  campaign_id: string | null;
  display_name: string | null;
  slug: string | null;
  ls_order_id: string | null;
};

export default async function Success({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const intentId = (await searchParams).r ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(intentId)) notFound();
  const rows = await query<IntentRow>(
    `SELECT i.status, i.mode, i.clicks_delta, i.expected_amount_cents,
            i.owner_token_hash, i.campaign_id::text AS campaign_id,
            i.display_name, i.ls_order_id, c.slug
       FROM checkout_intents i LEFT JOIN campaigns c ON c.id = i.campaign_id
      WHERE i.id = $1`,
    [intentId],
  );
  const row = rows[0];
  if (!row) notFound();
  const ownerHash = await ownerHashFromCookies();
  if (!ownerHashesMatch(row.owner_token_hash, ownerHash)) notFound();
  if (!row.slug || !row.campaign_id) {
    return <Shell><WaitingForPayment intentId={intentId} name={row.display_name ?? "your product"} /></Shell>;
  }

  const [campaign, queue, rate] = await Promise.all([
    getCampaignBySlug(row.slug),
    getQueueWithLive(),
    getRollingClicksPerHour(),
  ]);
  if (!campaign) notFound();
  const positionIndex = queue.findIndex((item) => item.id === campaign.id);
  const queuePosition = positionIndex >= 0 ? positionIndex + 1 : null;
  const estimates = estimateQueue(queue, rate);
  const startsIn = campaign.status === "live" ? "now" : formatEta(estimates[campaign.id]?.start ?? null, "about ");
  const highestPriority = Math.max(0, ...queue.filter((item) => item.status === "queued").map((item) => item.priority_cents));
  const nextJump = jumpPrice(highestPriority);
  const pageUrl = `${config.siteUrl.replace(/^https?:\/\//, "")}/u/${campaign.slug}`;

  return (
    <Shell>
      <XPurchaseEvent eventId={config.xPixel.purchaseEventId} conversionId={row.ls_order_id ?? intentId} amountCents={row.expected_amount_cents} />
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">You&apos;re in.</h1>
      {row.mode === "purchase" ? (
        <>
          <p className="mt-6 text-lg"><span className="font-semibold tabular">{row.clicks_delta} clicks</span><span className="mx-2 text-faint">·</span><span className="font-semibold tabular">{formatPrice(row.expected_amount_cents)}</span>{queuePosition ? <><span className="mx-2 text-faint">·</span><span className="font-semibold tabular text-accent">#{queuePosition} in queue</span></> : null}</p>
          <p className="mt-4 text-base text-muted">Your clicks start {startsIn === "now" ? "now" : startsIn === "—" ? "after the campaigns ahead of you complete" : `in ${startsIn}`}.</p>
        </>
      ) : <p className="mt-6 text-lg">{formatPrice(row.expected_amount_cents)} moved your campaign to the front of the queue.</p>}
      <p className="mt-6 text-base text-muted">Your page: <Link href={`/u/${campaign.slug}`} className="font-medium text-accent hover:underline">{pageUrl}</Link></p>
      <SuccessActions slug={campaign.slug} siteUrl={config.siteUrl} clicks={row.clicks_delta} priceCents={row.expected_amount_cents} campaignId={campaign.id} jumpPriceCents={campaign.status === "queued" ? nextJump : null} />
      <p className="mt-10 text-xs leading-relaxed text-faint">Your page, delivery progress and permanent leaderboard listing remain available after delivery.</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex-1 px-6 py-16"><div className="mx-auto w-full max-w-xl"><Link href="/" className="text-sm text-faint hover:text-accent">← yourhour</Link><div className="mt-10">{children}</div></div></main>;
}
