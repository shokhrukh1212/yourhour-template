# yourhour.lol — how it is built

## Context

`hourly-slot-spec.md` describes a website where exactly one product owns the entire
homepage for exactly one hour. Twenty-four slots a day, one global price for the whole
board that rises on every sale and decays every silent hour. When a bought hour begins,
the site announces it on X, and the buyer promotes that announcement to their own
audience — that self-promotion is the growth engine, which is what lets the site launch
without the operator having an audience.

This document describes **what is actually deployed**, not what was originally planned.
Where the build departs from the spec, the reason is recorded. The reference sites
(outbid.lol, topapp.lol) sell a *row* on a leaderboard. This sells **exclusivity plus a
deadline** — one product, one sentence, one button, one countdown, and then it's gone.

Status: live at [yourhour.lol](https://yourhour.lol), taking real payments.

---

## Decisions locked with the user

| Question | Decision |
|---|---|
| Stack | **Next.js (App Router) on Vercel**, not Express on a VPS |
| X auto-post | **Build it, with the link** — accept $0.20/post |
| Domain | **yourhour.lol** |
| Starting price | **$1**, floor **$1** — reset down from $19/$5 after launch |
| Price moves | **+20% per sale**; **−5%** per silent hour, but only past the third in a row. Rounded to the nearest **cent** |
| Ratchet | `P` never falls below **half its all-time high**, forever |
| Amounts | `P` is a **minimum, not a price**. Paying more buys rank on The Wall, not a bigger bump |
| Peak pricing | A time-of-day multiplier in **US Eastern** — `2.0×` / `1.0×` / `0.4×` — applied at display and checkout only. The stored `P` is one number |
| Clearance | An unsold hour inside **30 minutes** of starting goes to a flat **$1**, and still moves `P` |
| Purchase shapes | 1 hour, 3 in a row, or the same hour for 3 or 7 days. Any of them can be **gifted** |
| Cron driver | **External HTTP pinger** hitting `/api/cron/tick` hourly. Vercel crons are unusable here: Hobby allows 2/day, and the 24 hourly entries `vercel.json` used to declare were silently never registered |
| Board self-heal | **Yes** — idempotent `reconcileBoard()` on every page read |
| The live hour | **Sellable for its first 15 minutes**, then given away as an encore |

---

## Four places this build departs from the spec, and why

### 1. X's free API tier no longer exists — the auto-post costs real money

The spec says *"Check the current write limits before committing to the auto-post."*
Checked. As of **February 2026** X replaced tiered pricing with pay-per-use and **new
developers cannot sign up for a free tier at all**:

- Post **without** a URL: **$0.015**
- Post **containing a URL**: **$0.200**

The announcement contains a link, so a full 24-slot day is **$4.80/day ≈ $145/mo**. The
spec's own kill criterion is *under $100 in the first 7 days → shut it down*. The link
stays, so the build contains hard spend controls: `X_ANNOUNCE_ENABLED` (kill switch, no
redeploy needed), `X_DAILY_POST_CAP` (a counted, DB-backed daily budget in `counters`),
and announcements only for **sold** hours, so quiet days cost nothing.

### 2. The spec has no slot-reservation lock — two people can buy the same hour

The spec locks *price* for 10 minutes at checkout but never locks the *slot*. Two buyers
could open checkout for the same hour and both pay, with **no refunds** (§5) to fall back
on. Fixed with a `reserved` slot status: opening checkout reserves the slot **and** freezes
`P`, in one transaction. Expired reservations return to `open` during reconcile.

### 3. The `/r/:slotId` redirect destroys the backlink pitch

§2 sells the archive as a permanent backlink, but §7 routes every outbound click through a
302, which passes essentially no SEO value. Split by surface instead:

- **Live hour CTA and buyer page** → `/r/:slotId`, counted.
- **Archive rows** → direct dofollow `<a href>`. A real, permanent backlink.

### 4. Whole-dollar rounding freezes the board at $1

The original `roundToDollar` was applied *inside* `applySale`, so at a $1 entry price
`round(125/100) * 100 = 100` — the price could never move. Money is integer cents and
every move now rounds to the nearest **cent** (`lib/pricing.ts`). This is what makes the
$1 entry price possible at all.

---

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript | RSC for the board; Node runtime, not edge |
| Styling | Tailwind CSS v4 | Light/dark via `prefers-color-scheme` |
| Database | **Neon Postgres** via Vercel Marketplace | Plain `pg`, advisory-locked writes |
| Email | **Resend** via Vercel Marketplace | Three lifecycle emails |
| Payments | **Lemon Squeezy** | Merchant of Record — handles VAT/sales tax |
| Card images | `next/og` (satori + resvg) | No browser, no extra dependency |
| Analytics | **Vemetric** | `@vemetric/react` + `@vemetric/node` |
| Announcements | X API v2, OAuth 1.0a user context | Non-expiring tokens |
| Cron | Vercel crons, hourly at `:00` | Bearer-secret auth, driver-agnostic |

**On Lemon Squeezy vs Stripe:** Vercel Marketplace only offers Stripe for `payments`, and
marketplace-first is the normal default. Overridden here because LS is a **Merchant of
Record**, which handles international payouts and VAT/sales-tax remittance that Stripe
would leave to you. Its `custom_price` field (integer cents, overriding the variant price
per checkout) is exactly the primitive a dynamic board price needs — verified to accept a
100-cent charge. Note the fee: 5% + $0.50 leaves **$0.45 net** on a $1 sale.

**On the cron driver:** the tick endpoint authenticates with a plain
`Authorization: Bearer $CRON_SECRET`, so it is deliberately agnostic about *who* calls it.
Swapping Vercel crons for QStash or cron-job.org is config, not code.

---

## Data model

All timestamps `timestamptz` and **UTC**; all money `integer` cents. Rendered in the
visitor's local timezone client-side. Full DDL in `lib/schema.sql`, which is idempotent and
applied wholesale by `scripts/migrate.ts`.

- **`slots`** — one row per hour. `starts_at UNIQUE` is what makes slot creation
  idempotent: the reconciler can `INSERT ... ON CONFLICT DO NOTHING` and never duplicate an
  hour. Carries the buyer's fields, `price_paid` (this hour's *share* of the purchase),
  `clicks`, `encore_clicks`, `gifter_handle`, `standing_through`, `wall_entry_id`, and the
  three side-effect claim flags `announced` / `reminded` / `completed`.
- **`wall_entries`** — one row per **purchase**, not per hour: a single hour, a block, a
  standing run, or a Wall-only spot that consumes no hour at all. This owns the permanent
  public identity (`slug`) and `amount_paid`, which is what ranks it on The Wall. Webhook
  idempotency lives here (`ls_order_id UNIQUE`) rather than on `slots`, because one order
  can span many hours.
- **`board`** — a single row (`CHECK (id = 1)`) holding `price`, `last_sale_at`,
  `last_decay_at`, `silent_hours` and `all_time_high_floor` (the ratchet's memory).
- **`clicks`** — `PRIMARY KEY (slot_id, ip_hash)`. Dedupe is enforced by the database, not
  application logic. A slot *is* an hour, so the key already scopes dedupe to the hour.
  Raw IPs are never stored.
- **`reservations`** — holds the hours and freezes the *minimum* for the checkout
  window. `locked_price` is that minimum; `amount` is what the buyer chose to pay.
  `block_hours` and `standing_days` record which shape was bought.
- **`reservation_slots`** — every hour a reservation holds. `reservations.slot_id` is only
  the anchor; this is the full list, and it is what the sale iterates.
- **`wall_clicks`** — `PRIMARY KEY (entry_id, ip_hash)`. A Wall-only entry has no slot, so
  it needs its own counted redirect.
- **`visitors`** / **`visit_hours`** — anonymous browser-backed uniques, and one row per
  visitor per active hour. The rollup exists because `visitors` holds a single timestamp
  per browser and cannot answer "how many were here in each of the last 168 hours".
- **`counters`** — generic; currently the X daily spend cap.

---

## Core logic

### Pricing (`lib/pricing.ts`, `lib/peak.ts`)

One stored integer `P` moves on sales and silence:

```
floor(high)   = max(100, round(high * 0.5))        -- the ratchet, forever
applySale(P)  = max(floor, round(P * 1.20))        -- any purchase, once, whatever it cost
applyDecay(P) = max(floor, round(P * 0.95))        -- only past 3 consecutive silent hours
```

`P` is a **base, not a quote**. What one hour actually costs is derived from it at
display and checkout time and never stored:

```
peakMultiplier(at) = 2.0  if 09:00-16:59 US Eastern   (prime)
                     1.0  if 17:00-23:59              (unmarked)
                     0.4  if 00:00-08:59              (quiet)

hourFloor(P, at)      = max(100, round(P * peakMultiplier(at)))   -- flat $1 global minimum
hourPrice(P, at, now) = 100 if at is < 30 min away    -- last-minute clearance
                        hourFloor(P, at) otherwise
blockMinimum(P, at, n)    = hourFloor(P, at) * {1: 1, 3: 2.5}[n]
standingMinimum(P, at, d) = hourFloor(P, at) * {3: 2.5, 7: 5}[d]
```

The tier comes from the **named zone** through `Intl`, so daylight saving is ICU's problem
and no fixed UTC offset exists anywhere in the codebase. `lib/__tests__/peak.test.ts`
asserts both sides of the 2026 spring-forward and fall-back, which is what would catch an
offset creeping back in.

Clearance applies to a **single hour only**. It exists to fill one hour about to be
wasted, not to discount three of them or a week of them.

The window is 30 minutes rather than 60 for a structural reason: slots begin on the hour,
so at 60 minutes the *next* hour is always inside the window and nobody would ever have a
reason to pay its real price — they could simply wait. At 30 minutes it holds its tier
price for the first half of the hour and only then goes cheap. The predicate is unbounded
below, so the hour already in progress always clears.

The homepage's "from" price quotes the cheapest hour actually for sale, and the hero
quotes what `Claim this hour` will really charge — the live hour has always started, so
quoting `P` there would advertise a price the checkout does not ask for. The header badge
stays on `P`, because the drop countdown printed beside it describes that number and
nothing else.

`formatPrice` prints a whole number of dollars as `$21` and anything else as `$1.25`.
Cent rounding is load-bearing: at whole-dollar rounding `$1 × 1.20` rounds straight back
to `$1` and the board freezes.

### Purchase shapes (`lib/validate.ts`, `app/api/checkout/route.ts`, `lib/sale.ts`)

Four things can be bought, and three of them are the same code path:

| Shape | Hours held | Floor move | Wall entry |
|---|---|---|---|
| 1 hour | 1 | `× 1.20` | 1, full amount |
| 3 in a row | 3 consecutive | `× 1.20` once | 1, full amount |
| Standing, 3 or 7 days | 1/day, same hour | `× 1.20` once | 1, full amount |
| Wall spot | none | **none** | 1, full amount |

Every hour gets its own slot row, claim number and click count; `splitAmount` gives each
an even share of the payment so no per-hour surface ever overstates what was paid, and the
shares add back up exactly.

**Every outbound message is per appearance, not per hour.** A block gets one post, one
reminder and one summary — `claimRun()` claims the sibling hours under the same flag the
anchor hour was claimed with, walking forward for the post and reminder and backwards from
the final hour for the summary. Each message sums the clicks and payment shares it covers.

**Announcements are per appearance, not per hour.** A block of consecutive hours is one
sale and gets **one** post covering the run — `claimConsecutiveRun` claims the later hours
as the first is announced, so the cron cannot repost the same product once an hour. A
standing run is *not* grouped: its days are 24 hours apart, so each is genuinely its own
live moment. `slots.post_number` numbers those appearances in airing order and is taken in
the same statement that claims `announced`, then released if nothing was published —
`claim_number` stays the record of purchase order and is no longer printed anywhere.

A standing run needs slot rows past the 24-hour calendar horizon that `backfillOpenSlots`
maintains, so `reserveStandingHour` creates them itself with `ON CONFLICT (starts_at) DO
NOTHING`. It steps in `interval '24 hours'`, **not** `interval '1 day'` — a calendar day is
session-timezone-relative and would drift an hour across a DST change, missing the
UTC-anchored rows the client counted in exact 24-hour steps.

### Gifting

The **recipient's** handle is written into the ordinary `x_handle` column, so the
announcement mention, the Wall entry and `/u/{slug}` credit them with no extra plumbing.
The buyer's handle goes to `gifter_handle`, and the announcement's first line becomes
`This hour belongs to @them — gifted by @you`. The gift email is addressed to the
recipient but delivered to the **buyer**: a handle is all the system ever has of the
recipient, never an inbox. It closes with a line asking the buyer to forward it.

### Reconciliation (`lib/reconcile.ts`)

Idempotent and advisory-locked (`pg_advisory_xact_lock`), so concurrent requests serialize
instead of racing. A cheap read-only probe runs first, so the common case (nothing due)
never opens a write transaction.

1. **Expire reservations** — past `expires_at`, *or* whose hour has fully ended. Note the
   condition is "has finished", not "has started": the live hour is sellable for 15
   minutes, and since reconcile runs on every page render the older condition would have
   killed a live-hour reservation within milliseconds.
2. **Close elapsed hours** — `starts_at + 1h <= now()` → `past`.
3. **Decay catch-up** — one decay per fully elapsed clock hour with **zero sales across the
   whole site**. Looping is what makes a missed cron harmless: `P` is always correct for
   wall-clock time regardless of when the last tick ran.
4. **Backfill open slots** — a row for every hour out to the 24-hour horizon.

It runs on **every page render** as well as the cron tick, and deliberately performs **no**
outbound side effects, because it runs on reads.

### Side effects (`lib/side-effects.ts`) — cron tick only

Each step claims its database row *before* acting, so two ticks racing can never
double-post or double-email, and a failed send releases the claim for the next tick.

1. Current hour `sold` and `announced = false` → claim it *and* the rest of its
   consecutive run → post once to X. The `announced = false` predicate is repeated in the
   outer `WHERE` of that `UPDATE`: under READ COMMITTED two concurrent ticks can resolve
   the subquery to the same id, and re-checking only `id = X` would post the hour twice.
2. Hours starting in 25–35 min, `reminded = false` → claim the run → one reminder.
3. Hours that ended within the last 2 hours, `completed = false`, **and are the last of
   their run** → claim backwards → one summary carrying the block's total clicks and the
   full amount paid.

The one exception: a **mid-hour sale** is announced from the webhook (`lib/sale.ts`), not
the `:00` cron, because that cron already fired for the hour in question and would never
run again for it.

### The live hour

Any hour that has not started is buyable. The hour already running is buyable too, for its
first 15 minutes (`LIVE_CLAIM_WINDOW_MS` in `lib/time.ts`) — one shared predicate that four
separate guards agree on. Reservations on the live hour are clamped so nobody buys an hour
with two minutes left.

Past that window an unsold hour becomes an **encore**: the past buyer with the most clicks
gets the screen for free. Those clicks land in `slots.encore_clicks`, so an archive row
never stops meaning "clicks earned during that buyer's own hour".

### What the buyer keeps

Every sold hour gets a permanent page at **`/u/{slug}`**. The slug is derived from the
product name (`uiwize`, then `uiwize-2`) inside the sale transaction and **never
recomputed** — a posted link and a cached card both break if a slug moves. Enforced by a
unique index rather than trusted to the application. `/hour/{id}` is the old numeric
permalink and 308s to the slug, so confirmation emails already sent keep working.

**`/card/{slug}.png`** renders a 1200×630 receipt with `next/og`, wired as the page's
`og:image`, so pasting the link on X shows the card with no download step. The bottom line
pairs what they paid against the current board price; that gap is the reason it gets
shared. It is **not** cached to disk — a Vercel function's filesystem is per-instance and
wiped on cold start, so a write would silently do nothing — but served with edge cache
headers that lengthen once the hour is over. It can never be fully static: clicks keep
accruing and the board price keeps moving.

---

## Routes

```
app/
  page.tsx                          board: live hour + calendar + The Wall (RSC)
  u/[slug]/page.tsx                 permanent buyer page, owns the OG card
  card/[slug]/route.tsx             1200x630 receipt PNG
  hour/[id]/page.tsx                old permalink -> 308 to /u/{slug}
  about/  rules/                    static copy, incl. "no refunds"
  r/[slotId]/route.ts               click counter -> 302 to buyer URL (?encore=1 splits)
  w/[entryId]/route.ts              the same, for a Wall entry with no slot behind it
  api/
    checkout/                       reserve slot + lock price + create LS checkout
    webhooks/lemonsqueezy/          HMAC verify -> mark sold -> bump P -> confirm email
    cron/tick/  cron/tick/[hour]/   bearer auth -> reconcile + side effects
    board/                          JSON for the live click-count poll
    slot/[slug]/                    JSON for the buyer page's live numbers
    visitors/                       visitor id upsert + hourly rollup
lib/
  db  schema.sql  pricing  peak  reconcile  slots  sale  side-effects  board-state
  wall  wall-rank  click  validate  slug  slug-backfill  lemonsqueezy  x  email
  analytics  time  metadata
```

---

## The homepage, three hero states

- **A — sold.** The whole screen: `RIGHT NOW`, the hour range, a live `MM:SS left`
  countdown, the product name, one sentence, one `Visit →` button, the click count.
- **B — open, under 15 minutes in.** `Own this homepage for 60 minutes.` and a Claim button
  targeting the hour already in progress.
- **C — open, past 15 minutes (encore).** The top past buyer's product, free, plus the next
  open hour and its price.

The B→C flip is decided on the ticking **client** clock so it happens live at the 15-minute
mark, falling back to the server's clock before hydration. The hero never says an hour went
unclaimed — that reads as product failure to every first-time visitor.

Below that: the buy section with the price mechanic spelled out and an **honesty block**
quoting real traffic (`getVisitorsPerHour()`, a 7-day average from `visit_hours`), then the
permanent archive with `paid $X` on every row.

---

## Env vars

See `.env.example` for the annotated list. Values that matter to the mechanic:

```
BOARD_START_PRICE=100     PRICE_FLOOR=100     BOARD_START_DATE=2026-08-22
RESERVATION_MINUTES=10    CALENDAR_HOURS=24
X_ANNOUNCE_ENABLED=true   X_DAILY_POST_CAP=24   X_HANDLE=@shahzod1001
```

`X_HANDLE` is named to the buyer in the reminder email, so it must match the account that
actually posts.

---

## Verification

- `npm test` — pricing ladder, `formatPrice`, slug generation and the collision ladder.
- `npm run test:reconcile` — integration tests against a real database, including the
  regression that a live-hour reservation survives reconcile. **Destructive**: it opens
  with an unconditional `DELETE FROM slots` and resets the board. It refuses to run
  against a database holding completed orders unless explicitly overridden.
- `npm run test:e2e` — end-to-end checks against a running dev server. **Destructive**: it
  resets and seeds the board, so never point it at a database holding real sales.
- `.env.local` points at **production**. Neither destructive script, nor `npm run reset`,
  may be pointed at it — use a Neon branch.
- `npm run build && npm run lint`.

Card rendering must be checked by **opening the PNG**, not by status code — satori failures
produce a valid-but-wrong image (collapsed layout, overlapping text) that a 200 will not
catch.

---

## Risks

| Risk | Mitigation |
|---|---|
| X cost climbs to ~$145/mo at full volume | Kill switch + DB-backed daily cap; only sold hours post |
| Cron drifts or dies | Reconcile-on-read keeps the board correct regardless; the tick is a catch-up worker and self-heals. **But reconcile-on-read masks a dead tick** — the board looks healthy while nothing is announced or emailed, which is exactly how the Hobby cron limit went unnoticed. Check `counters` for today's `x_posts:` row to tell the two apart |
| Neon free tier auto-suspends on idle | Cold start on first request; the hourly tick keeps it warm |
| LS webhook missed entirely | Reconcile a `pending` reservation whose LS order shows paid, via the LS API, on tick |
| $1 sale nets $0.45 after LS fees | Accepted: the entry price is a customer-acquisition number, and the board climbs 20% per sale |
| Nobody buys | Spec's own kill criterion: under $100 in the first 7 days → shut it down. Don't optimize a dead board. |
