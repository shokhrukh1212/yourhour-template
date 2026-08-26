import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rules" };
const rules = [
  ["The leaderboard is permanent", "Every product that completes a bid stays visible. Products are ranked by their current total bid, highest first."],
  ["Bids use whole US dollars", "The first listing costs $3. After that, a product must bid at least $1 more than the position it wants to beat."],
  ["Existing products pay only the difference", "One domain has one listing. On the original browser, its owner can raise the total bid and pays only the difference between the old and new totals."],
  ["Payment completion decides rank", "A checkout does not reserve a position. If another payment completes first, your final position is calculated when your payment completes."],
  ["Completed bids are final", "Leaderboard bids buy permanent placement and are non-refundable. Your rank can move when another product pays more."],
  ["Clicks are verified and deduplicated", "A visitor can add at most one click to a product. Obvious bots, owners, and suspicious repeated activity are excluded where technically reliable. Raw IP addresses are never stored."],
  ["Product details come from the URL", "We read the name, pitch, and image from the submitted page. If it cannot be read, the buyer can enter a name and short pitch."],
  ["Ownership is browser-based", "A long-lived private cookie authorizes upgrades. If it is lost, contact support and provide the Lemon Squeezy receipt for manual recovery."],
];

export default function RulesPage() {
  return <main className="min-h-screen px-6 py-14"><div className="mx-auto max-w-2xl"><Link href="/" className="text-sm text-[#ff4c3f]">← YourHour</Link><h1 className="mt-8 text-5xl font-bold tracking-[-.05em]">Rules</h1><p className="mt-4 text-lg text-[#4e5967]">Pay more, move up, stay forever.</p><ol className="mt-12 space-y-8">{rules.map(([title, body], index) => <li key={title} className="grid grid-cols-[36px_1fr] gap-4 border-t border-[rgba(9,35,62,.14)] pt-6"><span className="text-sm text-[#ff4c3f]">{String(index + 1).padStart(2,"0")}</span><div><h2 className="font-bold">{title}</h2><p className="mt-2 leading-7 text-[#4e5967]">{body}</p></div></li>)}</ol></div></main>;
}
