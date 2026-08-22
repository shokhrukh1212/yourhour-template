# yourhour

Buy a permanent rank on The Wall. Your product also owns the entire homepage for an hour.

The Wall is the product; the hour is the bonus. Price is derived from the Wall itself and
only ever goes up.

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Database | Neon Postgres (Vercel Marketplace) via `pg` |
| Payments | Lemon Squeezy — Merchant of Record, dynamic `custom_price` per checkout |
| Analytics | Vemetric (`@vemetric/react` browser, `@vemetric/node` server) |
| Scheduling | Any HTTP pinger hitting `/api/cron/tick`, hourly |

## Getting started

```bash
npm install
vercel env pull            # pulls DATABASE_URL from the Neon integration
cp .env.example .env.local # then fill in the local-only values
npm run migrate            # applies lib/schema.sql
npm run seed:demo          # optional: realistic local data
npm run dev
```

Without Lemon Squeezy credentials the checkout falls back to a local stub at
`/api/dev/complete` so the full purchase flow can be exercised offline. The stub is hard
disabled in production and whenever real credentials are present.

## Pricing

`lib/pricing.ts` is the whole system, and it is three constants and one function:

```
minimum entry        = $3.00                          (MIN_ENTRY_CENTS)
price of rank #1     = highest amount_paid + $1.00    (numberOnePrice)
price on empty Wall  = $5.00                          (EMPTY_WALL_TOP_CENTS)
```

Nothing is stored. There is no floor row, no decay clock, no all-time-high ratchet, no
time-of-day multiplier and no clearance window. The only input is
`max(wall_entries.amount_paid)`, so the number can move only when a real person pays, and
it can only move up. **Nothing in the UI may suggest that waiting is cheaper**, because
nothing about it is.

A buyer may pay any amount at or above the minimum. That amount *is* their rank: pay above
the current top and you are #1, pay less and you take the rank the amount earns. Ties go to
whoever paid first (`amount_paid DESC, created_at ASC, id ASC`, in `lib/wall.ts`).

These are deliberately constants rather than env vars. The price is a promise to buyers,
and a promise that can be edited in a dashboard is not one.

## The purchase, in two actions

1. Paste a URL into the sticky bar and click **Claim**. That posts to `/api/preview`,
   which validates the URL and scrapes a product name and pitch from it.
2. A panel expands under the bar with the amount pre-filled at the #1 price, the rank it
   buys, and which hour it comes with. Click **Pay**.

`/api/checkout` re-runs every check server-side under the board lock, holds the assigned
hour for `RESERVATION_MINUTES`, and opens the Lemon Squeezy checkout. No email, no handle,
no hour picker, no checkboxes — Lemon Squeezy collects the email itself and sends the
receipt, so the site never asks for one.

**Hour assignment.** Checkout takes the earliest open hour and *reserves* it, so the hour
quoted before payment is the hour delivered after it. Picking a specific hour is a
collapsed text link most buyers never open. If every hour on the 24-hour calendar is taken
the checkout creates the next one past the end of it rather than refusing the sale, and
says so.

**The URL scrape** (`lib/metadata.ts`) reads `og:site_name` / `og:title` / `<title>` and a
description. `scraped: false` on the returned metadata means the page could not be read at
all, and only then does the panel show editable name and pitch fields. Two products cannot
share a name on the Wall, and `x.com` / `twitter.com` links are refused outright
(`lib/validate.ts`) — a social profile is not a product.

## After payment

The slug is assigned inside the sale transaction, so Lemon Squeezy redirects to
`/success?r={reservationId}` rather than to a page that may not exist yet. If the webhook
has not landed the page polls `/api/checkout/status` and swaps itself in when it has. It
shows the rank, the amount, the hour, the permanent link, and a **Share on X** button that
opens a prefilled compose window. There is no automatic announcement: the buyer posting
their own spot reaches more people than our account does.

## The Wall

`wall_entries` is one row per purchase — permanent, ranked by `amount_paid`, never reset.
That row, not the slot, owns the slug, the public page and the rank. Nobody is ever
removed.

The product name on the Wall is a **direct dofollow anchor**; every other link routes
through `/w/{entryId}` so the counts stay honest. A 302 passes no SEO value and that
permanent backlink is part of what was sold.

## Clicks

Two counted redirects, both deduping on a salted IP hash via a primary key (never a raw
IP). `/r/{slotId}` is the live hero and the upcoming-hours list and lands in
`slots.clicks`; `/w/{entryId}` is the Wall and the permanent page and lands in
`wall_entries.clicks`, so traffic arriving a week later never inflates the number an hour
earned while it was live. An entry's public total is the sum.

The hero prints `slots.clicks` labelled "clicks this hour". The Wall card for the same
product prints the larger lifetime rollup labelled "clicks". Two numbers, two labels, both
honest.

## Timezones

`slots.starts_at` is stored on exact **UTC** hour boundaries. `components/LocalTime.tsx`
formats with no `timeZone` option, i.e. the visitor's own — so a row that reads "4:00 PM"
really does begin at 4:00 PM where the reader is sitting, including on half-hour-offset
zones.

The old calendar labelled 1:00 AM as `PRIME` because the time was rendered in the
visitor's zone while the tier was classified in `America/New_York`. That system is gone.

`lib/db.ts` pins the Postgres session to UTC (`options: "-c timezone=UTC"`). Roughly
fifteen queries use `date_trunc('hour', now())` and compare it against `starts_at`; on a
`:30` or `:45` session zone that would floor to a non-`:00` boundary and the lookups would
silently stop matching.

## Reconciliation and the cron

`lib/reconcile.ts` retires stale reservations, closes hours that have finished, and keeps
the next 24 hours populated. It is idempotent, advisory-locked, guarded by a cheap
read-only probe, and runs on **every page render** as well as on the cron tick — so a late
or dead cron can never show a finished hour as live.

`/api/cron/tick` calls it and nothing else. Point any pinger at it hourly:

```
GET https://yourhour.lol/api/cron/tick?secret=<CRON_SECRET>
```

It matters only on a day with no visitors. Vercel **Hobby crons run once per day**, so
they cannot drive this; set `CRON_SECRET` **without** Vercel's "sensitive" flag, or you
will not be able to read it back.

## What a buyer keeps

A permanent page at `/u/{slug}`, where the slug comes from the product name (`uiwize`, then
`uiwize-2`). It is assigned once inside the sale transaction and never recomputed, because
posted links and cached cards depend on it. `/hour/{id}` is the old permalink and 308s to
it.

**The receipt card** (`/card/{slug}.png`) — a 1200×630 PNG rendered by `next/og`, wired as
the buyer page's `og:image`. The bottom line pairs what they paid against what #1 costs
now; that gap is what makes the card worth posting, and since the price only rises it gets
better with age.

## Tests

```bash
npm test               # pricing and ranking, pure units
npm run test:reconcile # the reconciler, against a scratch database
npm run test:e2e       # the full flow against a running dev server
```

`test:reconcile` refuses to run against a database holding completed orders, because The
Wall is permanent and there is nothing to restore it from. `test:e2e` is re-runnable: it
suffixes every product name and click IP with a run id, since a name already on the Wall is
refused and a click IP is deduped forever.

## Deploying

```bash
vercel env add ...   # everything in .env.example, for production
vercel --prod
npm run migrate      # against the production DATABASE_URL
```

`lib/schema.sql` is re-run in full on every migrate, so every statement in it is
idempotent. Schema changes go in as `ALTER TABLE ... IF EXISTS` statements appended to the
migration section at the bottom, *and* into the `CREATE TABLE` blocks at the top so a fresh
database gets the same shape.

Then add the Lemon Squeezy webhook pointing at `/api/webhooks/lemonsqueezy` with
`order_created` enabled, and register the cron pinger.

### One-off cleanup

```bash
npm run cleanup:wall              # dry run
npm run cleanup:wall -- --apply
```

Deletes the two legacy Wall entries titled "X (formerly Twitter)". Their slots are kept,
clicks and all, so no public counter moves.
