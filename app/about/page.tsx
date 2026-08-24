import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return <main className="flex-1 px-6 py-16"><div className="mx-auto w-full max-w-xl"><Link href="/" className="text-sm text-faint hover:text-accent">← yourhour</Link><h1 className="mt-8 text-4xl font-semibold tracking-tight">About</h1><div className="mt-8 space-y-5 leading-relaxed text-muted"><p>Most ads sell impressions and make the buyer guess what attention is worth. This site sells the result directly: a counted outbound click.</p><p className="text-foreground">One product owns the homepage until every purchased click lands. Then the queue advances automatically.</p><p>The price stays fixed at 20¢ per click. Pick 50, 100, 200 or 250 clicks, or choose a custom order from $5. There is no auction for delivery and no audience targeting dashboard.</p><p>A delivery guarantee keeps that promise concrete. If the campaign has not completed seven days after it goes live, the undelivered portion is refunded.</p><p>Every buyer also receives a permanent product page and leaderboard listing ranked by total amount paid. Queue jumps add to the same total, so one payment improves both visibility and rank.</p></div><p className="mt-10 border-t border-border pt-6 text-sm"><Link href="/rules" className="text-accent hover:underline">Read the rules →</Link></p></div></main>;
}
