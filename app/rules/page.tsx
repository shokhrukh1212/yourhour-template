import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rules" };

const RULES: [string, string][] = [
  ["You buy outbound clicks", "Each click costs 20¢. Orders start at 25 clicks for $5, with quick choices up to 250 clicks."],
  ["One product gets the featured spot", "The live campaign is the only featured product. It remains in place until every purchased click is delivered, then the first campaign in the queue takes over immediately."],
  ["Clicks are deduplicated", "A stable anonymous visitor can create at most one counted click per campaign. Obvious bots, suspicious repeated activity and the buyer's own device or purchase connection are excluded where technically reliable. Raw addresses are never stored."],
  ["Undelivered visits are refunded", "Visits depend on visitors choosing to open your product, so no delivery rate or timeframe is guaranteed. Each verified purchase has a deadline seven days after payment; at the deadline, undelivered visits are refunded at the rate originally paid to the original payment method."],
  ["Supply is limited", "We cap outstanding purchases using recent delivery volume. When the queue reaches that cap, new purchases pause until capacity is available again."],
  ["The queue is first paid, first served", "Queued campaigns are ordered by paid queue priority, then purchase date. With no queue priority payment, earlier purchases go first."],
  ["A queued buyer may jump", "The next queue jump costs one dollar more than the highest queue priority payment, with a $2 minimum. The payment moves that campaign forward and also increases its permanent leaderboard total."],
  ["The leaderboard is permanent", "Campaigns are ranked by total amount paid. Click purchases and queue jumps add to that total. A listing and its link remain visible after delivery."],
  ["Product details come from your link", "We read the name, pitch and icon from the product page. If the page cannot be read, you can enter the name and pitch yourself. Social profile links are not accepted."],
  ["Permanent pages remain public", "Every campaign has a page at yourhour.lol/u/your-product showing its tracked link, delivery progress, amount paid, status and leaderboard rank."],
];

export default function RulesPage() {
  return <main className="flex-1 px-6 py-16"><div className="mx-auto w-full max-w-xl"><Link href="/" className="text-sm text-faint hover:text-accent">← yourhour</Link><h1 className="mt-8 text-4xl font-semibold tracking-tight">Rules</h1><div className="mt-8 rounded-2xl border border-border bg-surface p-6"><h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">In short</h2><p className="mt-2.5 text-sm leading-relaxed text-muted">You pay 20¢ for each valid visit to your product. Visits are recorded when eligible visitors choose to open it, so the rate is not guaranteed. Anything undelivered after seven days is refunded.</p></div><ol className="mt-10 space-y-8">{RULES.map(([title, body], index) => <li key={title} className="flex gap-4"><span className="mt-0.5 shrink-0 text-sm tabular text-faint">{String(index + 1).padStart(2, "0")}</span><div><h2 className="font-medium">{title}</h2><p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p></div></li>)}</ol></div></main>;
}
