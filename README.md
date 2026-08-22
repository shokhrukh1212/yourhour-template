# yourhour

One product owns the entire homepage for exactly one hour. Twenty-four slots a day, one
price for the whole board. The price rises when people buy and falls when they don't.

Built from [`hourly-slot-spec.md`](./hourly-slot-spec.md). Build plan and the reasoning
behind every deviation from the spec live in [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Database | Neon Postgres (Vercel Marketplace) via `pg` |
| Payments | Lemon Squeezy — Merchant of Record, dynamic `custom_price` per checkout |
| Email | Resend (Vercel Marketplace) |
| Analytics | Vemetric (`@vemetric/react` browser, `@vemetric/node` server) |
| Announcements | X API v2, OAuth 1.0a |
| Scheduling | Any HTTP pinger hitting `/api/cron/tick` every 5 minutes |

## Getting started

```bash
npm install
vercel env pull            # pulls DATABASE_URL from the Neon integration
cp .env.example .env.local # then fill in the local-only values
npm run migrate            # applies lib/schema.sql, seeds the board price
npm run seed:demo          # optional: realistic local data
npm run dev
```

Without Lemon Squeezy credentials the checkout falls back to a local stub at
`/api/dev/complete` so the full purchase flow can be exercised offline. The stub is hard
disabled in production and whenever real credentials are present.

## How the board works

**Pricing** (`lib/pricing.ts`) — one global **floor** `P`, opening at `$1`. Any purchase
sets `P = P × 1.20`, once, however many hours it covered and however much was paid.
Silence is only expensive once it persists: the first three consecutive silent clock hours
cost nothing, and the fourth and each one after it sets `P = P × 0.95`. Underneath that
sits a ratchet — `P` never falls below half of the highest it has ever been
(`board.all_time_high_floor`), with the opening `$1` floor below that. No ceiling, always
rounded to the nearest **cent** — at whole-dollar rounding `$1 × 1.20` rounds straight
back to `$1` and the board freezes.

**`P` is the minimum, not the price.** Buyers may pay any amount at or above it. Paying
more does *not* push the floor higher; it buys rank on The Wall.

**Slugs live on the Wall entry**, not the slot — `applyHourBlock` writes
`wall_entries.slug` and leaves `slots.slug` null, so anything reading a slug from a slot
must `COALESCE` through the entry (`slots.slug` is only still populated for rows predating
the Wall). Reading `slots.slug` alone silently skips every block sale.

**Post numbering** — `slots.post_number` is the Nth hour to **go live**, taken inside
the same statement that claims `announced`, and released again if nothing was published.
It is deliberately not `claim_number`, which is the Nth *purchase*: the two orders diverge
the moment somebody books a later hour before somebody else books an earlier one, and the
public feed would then count backwards.

**Peak pricing** (`lib/peak.ts`) — `P` is a *base*, not a quote. What one hour costs is
`P` scaled by its time of day in **US Eastern**: `2.0×` from 09:00–16:59 (prime), `1.0×`
from 17:00–23:59, `0.4×` from 00:00–08:59 (dead), with a flat `$1` global minimum under
all three. The tier is derived from the named zone through `Intl`, so daylight saving is
handled for us and no fixed UTC offset appears anywhere. Nothing about the tier is ever
stored — it is applied at display and checkout time only, and a sale still moves `P` by
`× 1.20` regardless of which tier was bought.

**Last-minute clearance** — an hour still unsold within **30 minutes**
(`LAST_MINUTE_WINDOW_MS`) of starting drops to a flat `$1`, ignoring every multiplier, and
still moves `P` by `× 1.20`. The window is deliberately shorter than an hour: slots begin
on the hour, so a 60-minute window would put the *next* hour permanently on clearance and
remove any reason to pay its real price. At 30 minutes it holds its tier price for the
first half of the hour. The in-progress hour is always inside the window, since the
predicate is unbounded below. The homepage's "from" price quotes the cheapest hour
actually for sale rather than `P`, and the hero quotes what `Claim this hour` will really
charge; the header badge stays on `P`, because the decay countdown beside it describes
that number. Clearance applies to a single hour only — never to a block or a standing
hour.

**Blocks** — 1 or 3 consecutive open hours, at `1×` and `2.5×` the *anchor hour's* peak
floor. One purchase: one Wall entry holding the full amount, one `× 1.20` move of `P`, and
**one** X post, **one** reminder and **one** summary covering the whole run. `claimRun()`
claims the sibling hours under the same flag as the anchor hour is claimed, so the cron
cannot act on them again: it walks forward from the first hour for the post and the
reminder, and *backwards* from the last for the summary, stopping at the first gap — a
buyer who owns 3pm and 5pm but not 4pm is two appearances, not one. Each hour still
carries an even share of the payment in `slots.price_paid`; every message sums the shares
and clicks it covers, so its figures always match the airtime it names.

**Standing hours** — the same hour of the day on 3 or 7 consecutive days, at `2.5×` and
`5×` the anchor hour's peak floor, offered only when that hour is free on every one of
those days. Like a block it is one Wall entry and one `× 1.20`, but its days are 24 hours
apart, so each is a separate live moment and keeps its **own** announcement. The days run
past the 24-hour calendar horizon, so
`reserveStandingHour` creates those slot rows itself (`ON CONFLICT (starts_at) DO
NOTHING`, safe against `backfillOpenSlots`). `slots.standing_through` is denormalised onto
every day so a calendar row can render "held by @x through Aug 29" with no join.

**Gifting** — a purchase can name a recipient. The *recipient's* handle goes into the
ordinary `x_handle` column, so the announcement, the Wall entry and `/u/{slug}` all credit
them with no extra plumbing; the buyer's handle goes to `gifter_handle`, and the
announcement reads "This hour belongs to @them — gifted by @you". The gift email is
addressed to the recipient but delivered to the **buyer** — a handle is all we ever have
of the recipient — and closes with a line asking the buyer to forward it.

**The Wall** (`lib/wall.ts`, `components/Wall.tsx`) — a permanent leaderboard ranked by
`wall_entries.amount_paid`, descending, ties to whoever paid first. It never resets. Every
purchase writes exactly one `wall_entries` row, and that row — not the slot — owns the
slug, the permanent page and the ranking amount.

**The second product** — a Wall spot on its own, from `$5`, unlimited. It consumes no
slot, moves neither the floor nor the silent-hour count, and gets no X announcement. Both
products go through the one Lemon Squeezy variant, told apart by `kind` in the checkout
metadata.

**The live hour** — any hour that has not started is buyable. The hour already running is
buyable too, but only for its first 15 minutes (`LIVE_CLAIM_WINDOW_MS`); a mid-hour sale
is announced from the webhook rather than the `:00` cron. Past that window an unsold hour
becomes an **encore**: the past buyer with the most clicks gets the screen for free, and
those clicks land in `slots.encore_clicks` so an hour row keeps meaning "clicks earned
during that hour".

## The hourly tick is NOT a Vercel cron

`/api/cron/tick` must be hit at `:00` every hour. It is driven by an **external HTTP
pinger**, not by Vercel crons, because this project is on the **Hobby** plan:

> Hobby allows **2 cron jobs per project**, and only **once per day**.

`vercel.json` previously declared 24 hourly entries (one per hour, a common workaround for
the daily-only limit). Vercel accepted the deployments and **silently registered none of
them** — no error, no warning, just a tick that never fired. Nothing announced, no reminder
emails, no completion emails. Symptoms to recognise it again:

- `counters` has no `x_posts:YYYY-MM-DD` row for today
- sold hours sit at `announced = false` after their hour has started
- but `board.last_decay_at` is current — that is `reconcileBoard()` running on page
  renders, which proves the *site* is alive and says nothing about the cron

**Setup.** Point any pinger (cron-job.org, UptimeRobot, QStash) at:

```
https://yourhour.lol/api/cron/tick?secret=<CRON_SECRET>
```

Schedule it at **`:00` and `:30`**, not hourly. Both are load-bearing:

- **`:00`** announces the hour that just went live. Any later and the post is late.
- **`:30`** is the only time the 30-minute reminder can be sent. Hours begin on the hour,
  so a `:00` tick sees the next hour 60 minutes out and the following `:00` tick sees it
  already started — an on-the-hour schedule can *never* satisfy the reminder window. The
  band is 20–40 minutes so ten minutes of drift either side of `:30` still lands.

Set `CRON_SECRET` **without** Vercel's "sensitive" flag. Sensitive variables are
write-only and cannot be read back by the CLI, the API, or you in the dashboard — the
original was sensitive and had to be thrown away and replaced. The endpoint is idempotent and claims every row
before acting, so a double-fire cannot double-post or double-email, and a missed tick heals
on the next one. Bearer auth (`Authorization: Bearer <CRON_SECRET>`) works too, for pingers
that send headers.

**If the project ever moves to Pro**, put this back in `vercel.json` and drop the pinger:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "0 * * * *" }] }
```

**Reconciliation** (`lib/reconcile.ts`) — an idempotent, advisory-locked pass that closes
elapsed hours, expires stale reservations, applies any owed decay, and backfills the
24-hour calendar. It runs on **every page render** as well as on the cron tick, so a late
or dead cron can never show a finished hour as live. It performs no outbound side effects.

**Side effects** (`lib/side-effects.ts`) — the X post and the two lifecycle emails, which
must not run on reads. Cron tick only. Each step claims its database row before acting, so
two ticks racing can never double-post or double-email.

**Reservations** — opening checkout holds the slot *and* freezes `P` for 10 minutes in one
transaction. The spec froze only the price, which let two buyers pay for the same hour.

**Clicks** — two counted redirects, both deduping on a salted IP hash via a primary key
(never a raw IP). `/r/:slotId` is the live hero and the upcoming-hours list, and lands in
`slots.clicks`. `/w/:entryId` is the Wall and the permanent page, and lands in
`wall_entries.clicks` — so traffic arriving a week later never inflates the number an hour
earned while it was live. An entry's public total is the sum of the two. The product name
on the Wall links **directly** to the buyer's URL, because a 302 passes no SEO value and
that permanent backlink is part of what was sold.

**What a buyer keeps** — every purchase gets a permanent page at `/u/{slug}`, where the
slug comes from the product name (`uiwize`, then `uiwize-2`). It is assigned once inside
the sale transaction and never recomputed, because posted links and cached cards depend on
it. `/hour/{id}` is the old permalink and 308s to it, so confirmation emails already sent
keep working.

**The receipt card** (`/card/{slug}.png`) — a 1200×630 PNG rendered by `next/og`, wired as
the buyer page's `og:image`. Pasting the page link on X renders the card with no download
step. The bottom line pairs what they paid against the current board price; that gap is
what makes the card worth posting. It is not cached to disk — a Vercel function's
filesystem is per-instance and wiped on cold start — but served with edge cache headers
that lengthen once the hour is over.

**Two emails** — a reminder 30 minutes before the hour starts, and a summary the moment it
ends carrying the click count, what they paid, and what an hour costs now.

## Scheduling

Point any pinger at the tick endpoint every 5 minutes:

```
GET https://yourhour.lol/api/cron/tick
Authorization: Bearer $CRON_SECRET
```

The endpoint is deliberately driver-agnostic — cron-job.org, Upstash QStash, or native
Vercel crons (Pro plan) all work without a code change. Vercel **Hobby crons run only once
per day**, so they cannot drive this.

## X announcement costs

X removed the free tier for new developers in February 2026. Posting is pay-per-use:

| | Cost |
|---|---|
| Post without a link | $0.015 |
| **Post with a link** | **$0.200** |

The announcement includes a link, so a fully sold day costs about **$4.80**. Two hard
controls: `X_ANNOUNCE_ENABLED` is a kill switch, and `X_DAILY_POST_CAP` is a
database-backed ceiling enforced atomically *before* any request is made. Unsold hours
never post.

## Tests

```bash
npm test              # pricing engine, incl. the spec's worked example
npm run test:reconcile # reconciler against the real dev database
npm run test:e2e      # full flow against a running dev server
```

`test:e2e` covers input validation, the current-hour lock, reservation, double-booking
refusal, payment → 20% bump, paying above the floor, a Wall-only purchase, a 3-hour
block, webhook idempotency, click dedupe, cron auth, and the Wall backlink.

## Deploying

```bash
vercel env add ...   # everything in .env.example, for production
vercel --prod
npm run migrate      # against the production DATABASE_URL
```

Then register the cron pinger and add the Lemon Squeezy webhook pointing at
`/api/webhooks/lemonsqueezy` with `order_created` enabled.

Before announcing: **seed the first 24 hours.** An empty calendar looks dead and nobody
buys from a dead site.
