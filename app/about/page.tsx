import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return <main className="flex-1 px-6 py-16"><div className="mx-auto w-full max-w-xl"><Link href="/" className="text-sm text-faint hover:text-accent">← yourhour</Link><h1 className="mt-8 text-4xl font-semibold tracking-tight">About</h1><div className="mt-8 space-y-5 leading-relaxed text-muted"><p>Most ads sell impressions and make the buyer guess what attention is worth. This site sells the result directly: a counted outbound click.</p><p className="text-foreground">One product holds the featured spot until the visits it purchased are delivered. Then the queue advances.</p><p>The price stays fixed at 20¢ per click. Orders start at 25 clicks for $5, with quick choices up to 250 clicks. There is no auction for delivery and no audience targeting dashboard.</p><p>Visits are recorded when visitors choose to open the featured product, so no delivery rate or timeframe is guaranteed. Each verified purchase has a seven-day deadline; any undelivered portion is refunded.</p><p>Every buyer also receives a permanent product page and leaderboard listing ranked by total amount paid.</p></div><p className="mt-10 border-t border-border pt-6 text-sm"><Link href="/rules" className="text-accent hover:underline">Read the rules →</Link></p></div></main>;
}
