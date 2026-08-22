# One Hour — Product Spec

A website where exactly one product owns the entire homepage for exactly one hour.

Twenty-four slots a day. One price for the whole board. The price rises when people buy and falls when they don't. When your hour starts, the site announces you publicly — and you bring your own audience to see it.

---

## 1. The core idea

Leaderboard sites (outbid.lol and similar) sell you a *row*. You are #1, but #2 through #50 are on the same screen, and the visitor's eye keeps moving.

This sells **exclusivity plus a deadline**. For sixty minutes there is nothing else on the page. When the hour ends, it's gone and someone else has it.

Two things make it work:

- **A countdown converts.** "27 minutes left" does work that a static list never does.
- **The buyer becomes the traffic.** Someone who just paid for an hour of undivided attention will promote that hour themselves. That's the growth engine, and it doesn't require the operator to have an audience.

---

## 2. What the page looks like

### Above the fold — the live hour

```
                    R I G H T   N O W
              2:00 PM – 3:00 PM  ·  27:41 left

                       ranked.ai
        Get ranked everywhere you're searched.
              One provider. SEO, PPC, AI.

                     [  Visit →  ]

                      84 clicks
```

That is the whole screen. One product, one sentence, one button, one countdown.

If the hour is unsold:

```
              2:00 PM – 3:00 PM  ·  27:41 left

                 This hour went unclaimed.

            Next open hour: 3:00 PM — $19
                     [  Claim it  ]
```

Still a countdown, still a price, still a call to action.

### Middle — the calendar

The next 24 open hours, as a scrollable list. Every open hour shows the same price.

| Hour | Status | |
|---|---|---|
| 3:00 PM | Open — **$19** | Claim |
| 4:00 PM | Taken — *overskill.com* | — |
| 5:00 PM | Open — **$19** | Claim |
| 6:00 PM | Open — **$19** | Claim |

Booked future hours show **the name only**. No pitch, no link. Otherwise someone buys a cheap 4am slot and gets free permanent exposure without ever paying for prime time.

### Below the fold — the archive

Every past hour, permanently, as small rows:

```
2:00 PM Aug 21   ranked.ai            84 clicks
1:00 PM Aug 21   limestonedigital     40 clicks
12:00 PM Aug 21  overskill.com        112 clicks
```

The archive does three jobs: it proves the site is used, the public click counts sell the next slot, and the buyer's link stays live forever — so $20 also buys a permanent backlink. That makes the pitch much easier.

---

## 3. Pricing

**There is one price for the entire board.** Call it `P`. Every open hour costs `P`. There is no per-slot price.

Two rules move it:

| Trigger | Effect |
|---|---|
| Any slot is sold | `P = P × 1.15` |
| A full clock hour passes with zero sales | `P = P × 0.90` |

Floor: **$5**. No ceiling. Round to the nearest dollar.

The decay trigger is **silence across the whole site**, not "this particular slot went unsold." That distinction matters — it's what keeps this to one number instead of twenty-four.

### Worked example

Board opens at $20.

| Clock | Event | New P |
|---|---|---|
| 1:00 PM | 5 PM slot sells for **$20** | $23 |
| 2:00 PM | hour ends, no sales | $21 |
| 3:00 PM | hour ends, no sales | $19 |
| 4:00 PM | 8 PM slot sells for **$19** | $22 |
| 5:00 PM | hour ends, no sales | $20 |
| 6:00 PM | 9 PM slot sells for **$20** | $23 |

The price hunts for the level people will actually pay. Priced too high, two quiet hours pull it back down. Selling fast, it climbs. It corrects itself with no intervention.

### Hard rule: the current hour is locked

**You can only buy hours that have not started yet.** At 3:15 PM, the 3 PM slot is gone forever and is not for sale at any price.

This single rule eliminates every messy edge case — no pro-rating a half hour, no swapping someone out mid-countdown, no ambiguity about when the announcement fires.

### Price lock at checkout

When a buyer opens checkout, freeze `P` for that buyer for 10 minutes. Otherwise a sale elsewhere changes the price mid-payment and you get a support email. Expired lock returns them to the current price.

---

## 4. The growth loop

When an hour begins and the slot is sold, the site's X account posts automatically:

> The next 60 minutes belong to @handle —
> *"Build production-ready apps in minutes with AI."*
> Live right now →
> [link]

The buyer will quote-tweet this essentially every time. They paid for an hour of attention and they want clicks to justify it, so **they push their own followers to your site.** Twenty sold slots means twenty people marketing your domain that day.

This is the entire answer to launching without an audience. It's structural, not something you have to hustle for each day.

Reinforce it with the live click counter on the buyer's own hour. That number is what makes them buy again tomorrow — and what they screenshot.

---

## 5. Purchase flow

1. Buyer picks an open hour, sees price `P`
2. Enters: **URL**, **display name**, **one sentence** (max 120 characters), **email**
3. Lemon Squeezy checkout
4. On payment success: slot marked sold, `P` bumped 15%, confirmation email with the hour and a link to their live page
5. Reminder email 30 minutes before their hour starts, so they're ready to post

No accounts, no passwords. Email is the identifier. Magic link only if you later need editing.

**One slot per checkout in v1.** Want three hours? Three purchases — which bumps the price three times, in your favour. Multi-buy is a v2 problem.

**No refunds.** State it plainly at checkout. You're selling a time slot; once it passes, it's consumed.

---

## 6. Data model

```sql
slots (
  id
  starts_at        timestamptz  -- UTC, always exactly on the hour
  status           -- 'open' | 'sold' | 'past'
  buyer_email
  display_name
  url
  pitch
  price_paid       integer      -- cents
  clicks           integer default 0
  announced        boolean default false
  created_at
)

board (
  id               -- single row
  price            integer      -- cents, current P
  last_sale_at     timestamptz
  last_decay_at    timestamptz
)

clicks (
  slot_id
  ip_hash
  created_at
)
```

Store everything in **UTC**. Display in the **visitor's local timezone** — the audience is global and nobody should have to convert.

---

## 7. Jobs

**Hourly cron, at :00**

1. Close the hour that just ended → `status = 'past'`
2. If the new hour's slot is sold and `announced = false` → post to X, set `announced = true`
3. Check for sales in the last hour. Zero sales → apply the 10% decay
4. Create the new open slot 24 hours out

**Click tracking**

Outbound button hits `/r/:slotId` → increment counter → 302 to the buyer's URL. Dedupe on hashed IP within the same hour so one person refreshing doesn't inflate the number. The counts are public in the archive, so they need to look honest.

---

## 8. Stack

TypeScript, Node, Express, Postgres — your existing stack.

- **Payments:** Lemon Squeezy (Merchant of Record, which you already use for international payouts)
- **Announcements:** X API v2, posting from your own account
- **Email:** Resend or similar for confirmations and the 30-minute reminder
- **Hosting:** anything with cron; a single small box is enough

### One constraint to verify before you build

X's free API tier caps monthly posts, and 24 announcements a day would exceed it. Check the current write limits before committing to the auto-post. Early on you won't sell 24 slots a day, so it will likely fit — but confirm the number, and know that outgrowing it means paying for a higher tier. If the limits don't work, a cheap fallback is posting a single daily summary of who's on the board and leaving individual announcements to the buyers.

---

## 9. Launch

**Seed the first 24 hours before you announce anything.** Charge friends $5. An empty calendar looks dead and nobody buys from a dead site. This is the step that decides whether the launch works.

Then post the launch on X. The screenshot that spreads is a full board with real names and a climbing price — not the concept.

**Day one price: $5.** Start it low enough to be an obvious yes. The escalation is the story; the starting number isn't.

### Domain

Something that states the mechanic. `onehour`, `60min`, `thishour`, `yourhour` — on `.lol`, `.xyz`, or `.site`. Buy it today.

---

## 10. Scope

**In v1:**
- One live slot, full screen, countdown
- 24 hours of open calendar
- Single board price, +15% / −10%, $5 floor
- Current hour locked
- Permanent archive with public click counts
- Auto-post on hour start
- Live click counter

**Explicitly not in v1** — add only if people pay:
- Time-of-day price multipliers
- Contesting or outbidding an already-booked future hour
- Consecutive-hour streaks and badges
- Rollover of unsold hours to the previous holder
- Multi-slot checkout
- Sponsor slots on the archive page

Every one of these was discussed and every one of them is a reason to not ship. They stay out until v1 makes money.

---

## 11. Expectations

Twenty-four slots a day. Realistically $15–70 each once there's momentum. You will not sell out.

- **Working:** $100–400/day
- **Upside:** a bidding war during someone's launch week pushes a prime hour past $300
- **Most likely:** a spike at launch, then a decline unless the archive click counts are good enough to bring buyers back

This is a lottery ticket. The ticket costs one weekend. That's a fine trade as long as it stays one weekend.

**Kill criterion: under $100 in the first 7 days → shut it down and build the next one.** Don't optimize a dead board.

---

## Build target

**One day.** Domain today, live before Monday.
