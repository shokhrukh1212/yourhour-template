import Link from "next/link";
import type { Metadata } from "next";
import { EMPTY_WALL_TOP_CENTS, MIN_ENTRY_CENTS, formatPrice } from "@/lib/pricing";
import { getVisitorsPerHour } from "@/lib/slots";

export const metadata: Metadata = { title: "Rules" };
export const dynamic = "force-dynamic";

const RULES: [string, string][] = [
  [
    "The Wall is what you're buying",
    "Every purchase gets a permanent row on The Wall, ranked by your bid per hour. Nobody is ever removed and nothing that happens later moves you down. Your selected homepage time comes with it.",
  ],
  [
    "The price comes from the Wall itself",
    `Rank #1 costs one dollar more than the highest amount anyone has paid, rounded up to a whole dollar. That is the whole pricing system. Nothing is stored, nothing is scaled by time of day, and nothing decays — the number can only move when a real person pays, and it can only move up. On an empty Wall, #1 costs ${formatPrice(EMPTY_WALL_TOP_CENTS)}.`,
  ],
  [
    "You can pay any amount from $3",
    `${formatPrice(MIN_ENTRY_CENTS)} is the minimum to get on the Wall at all. Whatever you pay is your rank: pay more than the current top and you are #1, pay less and you take the rank that amount earns. Ties go to whoever paid first.`,
  ],
  [
    "Waiting never makes it cheaper",
    "There is no countdown, no clearance, no quiet-hour discount. The price you see is the price, and the only direction it moves is up.",
  ],
  [
    "You also get homepage time",
    "Choose 1, 2, 3, or 6 consecutive hours. When your time starts, the entire page is your name, your sentence and your link. Nothing else is on screen. You get the earliest open block unless you pick a different start time at checkout.",
  ],
  [
    "Empty hours stay empty",
    "If nobody bought the hour that is running, the homepage says so. We never fill it with somebody else's product for free.",
  ],
  [
    "Your name and pitch come from your own page",
    "We read them from the link you paste. If we can't reach the page you type them in yourself. Two products can't share a name on the Wall, and links to social profiles aren't accepted — this is a list of products.",
  ],
  [
    "Booked future hours show the product name",
    "Booked hours show the product name and a counted link. The full takeover and the live click counter begin when each hour starts.",
  ],
  [
    "Your page is permanent",
    "Every purchase keeps its own page at yourhour.lol/u/your-product, with your link, your sentence, a public click count and your place on the Wall, for as long as this site exists. Paste that link anywhere and a card fills itself in: what you paid, what you got, and what #1 costs now.",
  ],
  [
    "Click counts are deduplicated",
    "Repeat visits from the same person don't inflate the number. Clicks earned during your own hour and clicks arriving later from the Wall are counted separately, and your public total is the sum. The counts are public, so they have to be honest.",
  ],
  [
    "No refunds",
    "A place on the Wall is permanent from the moment it's bought, and homepage time is a time slot — once it passes it's consumed. Neither comes back.",
  ],
];

export default async function RulesPage() {
  const perHour = await getVisitorsPerHour();

  return (
    <main className="flex-1 px-6 py-16">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-sm text-faint hover:text-accent">
          ← yourhour
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Rules</h1>

        {/* Moved off the checkout form, but not deleted: it is still the most important
            thing a buyer should read before paying. */}
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-faint">
            What you&apos;re not buying
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-muted">
            Traffic.{" "}
            {perHour > 0
              ? `This site gets about ${perHour.toLocaleString()} ${perHour === 1 ? "visitor" : "visitors"} an hour right now.`
              : "This site gets almost no traffic right now."}{" "}
            We&apos;re not going to pretend otherwise. What you get is a permanent,
            ranked, dofollow listing and an hour where nothing competes with you — the
            hour is worth what you make it worth, so bring your own people and it becomes
            a launch moment.
          </p>
        </div>

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
