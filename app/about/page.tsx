import Link from "next/link";
import type { Metadata } from "next";
import { MIN_ENTRY_CENTS, formatPrice } from "@/lib/pricing";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">
          ← yourhour
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">About</h1>
        <div className="mt-8 space-y-5 leading-relaxed text-muted">
          <p>
            Leaderboard sites sell you a row. You&apos;re #1, but #2 through #50 are on
            the same screen and the visitor&apos;s eye keeps moving.
          </p>
          <p className="text-foreground">
            The Wall is a leaderboard nobody can push you off. You buy a rank, it&apos;s
            ranked by what you paid, and it is permanent — no expiry, no renewal, no
            algorithm that quietly reshuffles it next month.
          </p>
          <p>
            The price is not something we set. Rank #1 costs a dollar more than the most
            anyone has paid, and that is the entire pricing system. It moves only when a
            real person pays, and it only moves up. There is no countdown, no discount for
            waiting, and nothing that gets cheaper if you close the tab — which means the
            number you see is the honest one.
          </p>
          <p>
            You can pay any amount from {formatPrice(MIN_ENTRY_CENTS)}. Whatever you pay
            is your rank. Pay more than the current top and you take #1; pay less and you
            take the rank that amount earns, above everyone who paid less than you and
            below everyone who paid more.
          </p>
          <p>
            Every purchase also gets an hour on the homepage. For sixty minutes there is
            nothing else on the page: your name, your sentence, your link. That hour is
            worth what you make of it — the page is yours, but the clicks come from the
            audience you point at it, and the buyers who do well are the ones who tell
            people their hour is running.
          </p>
          <p>
            When an hour is unsold the homepage says it is empty. We never fill it with
            somebody else&apos;s product for free, because a visitor who sees a product
            that didn&apos;t pay learns the wrong thing about what is being sold here.
          </p>
          <p>
            Every purchase keeps its page, its click count and its place on the Wall
            permanently, so what you bought doesn&apos;t disappear when the countdown
            does. You get a named page at
            <code className="mx-1 text-foreground">yourhour.lol/u/your-product</code>
            that renders as a card wherever you post it — showing what you paid against
            what #1 costs now. Early buyers tend to like that second number more as time
            goes on.
          </p>
        </div>
        <p className="mt-10 border-t border-border pt-6 text-sm">
          <Link href="/rules" className="text-accent hover:underline">
            Read the rules →
          </Link>
        </p>
      </div>
    </main>
  );
}
