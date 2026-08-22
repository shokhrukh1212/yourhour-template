import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rules" };

const RULES: [string, string][] = [
  [
    "One product owns the homepage for one hour",
    "Twenty-four slots a day. When your hour starts, the entire page is your name, your sentence, and your link. Nothing else is on screen.",
  ],
  [
    "There is one base price for the whole board",
    "One number sits under every open hour. It rises 20% every time somebody buys, whatever they bought or what time of day it was. Silence is only expensive once it persists: three quiet hours in a row cost nothing, and only the fourth and each one after it take 5% off. There is no ceiling.",
  ],
  [
    "What an hour costs depends on when it is",
    "The base price is scaled by the time of day, in US Eastern. 9am to 5pm costs 2x — that is prime. 5pm to midnight costs the base price. Midnight to 9am costs 0.4x, because almost nobody is awake. Daylight saving is followed, so the bands track the actual clock in New York. No hour is ever priced below $1, whatever the maths says.",
  ],
  [
    "The base price can never fall below half its all-time high",
    "Once the board has been somewhere, it never gives all of it back. If the base price reaches $40 it never falls under $20 again, however quiet it gets. The opening price of $1 sits underneath that.",
  ],
  [
    "The price you are quoted is a minimum, not a price",
    "You can always pay more. Paying more does not push the base price up any further — one sale moves it 20%, whether you paid the minimum or ten times it. What it buys is your rank on The Wall, and that is permanent.",
  ],
  [
    "The Wall never resets",
    "Every purchase gets a permanent row on The Wall, ranked by what was paid. Nothing that happens later moves you down. You can also buy a Wall spot on its own, from $5, without buying an hour — it takes no slot, moves no price, and never expires.",
  ],
  [
    "Hours can be bought in blocks",
    "One hour, or three in a row, as long as that many consecutive hours are open. Three cost 2.5x what the first of them costs, so a block is cheaper per hour. It is one sale throughout: one announcement covering the whole run, one reminder before it, one summary after it, one row on The Wall at the full amount, and one 20% move of the base price.",
  ],
  [
    "You can hold the same hour every day",
    "A standing hour is one hour of the day, on three or seven consecutive days. It costs 2.5x or 5x what that hour costs on its own, and it is only offered when that hour is free on every one of those days. Because the days are apart, each one is its own moment and gets its own announcement and its own click count — but it is one payment, one row on The Wall at the full amount, and one 20% move of the base price.",
  ],
  [
    "An unsold hour goes for $1 in its last half hour",
    "Once an hour is less than thirty minutes from starting and still unsold, it drops to a flat $1 — no tier, no multiplier, no exceptions. It still moves the base price 20% like any other sale. Blocks and standing hours are never cleared this way, and neither is an hour anybody has already bought: the discount exists to fill one hour that is about to be wasted, not to reward waiting.",
  ],
  [
    "You can buy an hour for somebody else",
    "Tick the gift box at checkout and give two handles: theirs and yours. Their product owns the hour, their name is on the permanent page, and the launch post reads “This hour belongs to @them — gifted by @you”. The Wall entry names both. The receipt and the note to forward on both come to you, because a handle is all we ever have of them.",
  ],
  [
    "The hour in progress is for sale for 15 minutes",
    "Any hour that has not started yet is always available. The hour already running can still be bought during its first 15 minutes — you go live within about a minute of paying. After that it is gone forever, at any price, and it goes to a past buyer as a free encore instead.",
  ],
  [
    "An unclaimed hour becomes an encore",
    "If nobody buys the live hour in time, the past buyer with the most clicks gets the screen for free. Encore clicks count toward that buyer's running total, but never toward the click count shown on the hour they actually paid for.",
  ],
  [
    "Your price is held for 10 minutes",
    "Opening checkout freezes the price and holds the hour for you. If you don't finish, both are released and the hour goes back on the board.",
  ],
  [
    "Booked future hours show the product name",
    "Booked hours show the product name and a counted link. The description, full takeover, and live click counter begin when the hour starts.",
  ],
  [
    "Your page is permanent",
    "Every purchase keeps its own page at yourhour.lol/u/your-product, with your link, your sentence, a public click count and your place on The Wall, for as long as this site exists. Paste that link anywhere and a card fills itself in: what you paid, what you got, and what an hour costs now.",
  ],
  [
    "Click counts are deduplicated",
    "Repeat visits from the same person don't inflate the number. The counts are public, so they have to be honest.",
  ],
  [
    "No refunds",
    "An hour is a time slot: once it passes, it's consumed. A Wall spot is permanent from the moment it's bought. Neither comes back.",
  ],
];

export default function RulesPage() {
  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">
          ← yourhour
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Rules</h1>
        <ol className="mt-10 space-y-8">
          {RULES.map(([title, body], i) => (
            <li key={title} className="flex gap-4">
              <span className="mt-0.5 shrink-0 text-sm tabular text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-medium">{title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
