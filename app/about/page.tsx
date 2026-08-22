import Link from "next/link";
import type { Metadata } from "next";

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
            This sells exclusivity and a deadline. For sixty minutes there is nothing
            else on the page. When the hour ends it&apos;s gone, and somebody else has it.
          </p>
          <p>
            The price finds its own level. Every sale pushes the base price up 20%.
            Silence pulls it back down, but slowly and never all the way: three quiet
            hours in a row cost nothing, the fourth and each one after take 5%, and it
            never falls below half of the highest it has ever been. Nobody sets it.
          </p>
          <p>
            What a particular hour costs is that base price scaled by the time of day.
            The middle of the US working day is worth twice a midnight hour, so it costs
            twice as much, and the dead hours cost less than half. And an hour still
            unsold half an hour before it starts drops to a flat $1 — it is about to be
            wasted, so somebody may as well have it.
          </p>
          <p>
            The number you are quoted is a minimum, not a price. You can pay more, and
            the only thing more buys is rank — a permanent row on The Wall, ordered by
            what was paid, that nothing later can push you down. If you just want the row
            and not the hour, you can buy that on its own from $5.
          </p>
          <p>
            You can take three hours back to back, or hold the same hour of the day for
            three or seven days running. And you can buy an hour for somebody else: their
            product owns the screen, the post credits both of you.
          </p>
          <p>
            An hour here is worth what you make of it. The page is yours, but the clicks
            come from the audience you point at it. The buyers who do well are the ones
            who tell people their hour is running.
          </p>
          <p>
            Every purchase keeps its page, its click count and its place on The Wall
            permanently, so what you bought doesn&apos;t disappear when the countdown
            does. You get a named page at
            <code className="mx-1 text-foreground">yourhour.lol/u/your-product</code>
            that renders as a card wherever you post it.
          </p>
          <p>
            When the hour closes we email you what it did — your click count, what you
            paid, and what an hour costs now. Early buyers tend to like that second
            number more as time goes on.
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
