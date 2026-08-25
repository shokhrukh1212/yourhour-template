# yourhour

One product takes the featured spot until its guaranteed outbound clicks are delivered.

## Product model

- 20¢ per counted outbound click (`CLICK_RATE_CENTS` in `lib/pricing.ts`)
- orders start at 25 clicks / $5 and stay at the fixed 20¢ rate up to 250 clicks
- quick choices of 50, 100, 200 and 250, plus synchronized click and price controls
- one live campaign; remaining campaigns ordered by paid priority then creation date
- permanent `/u/{slug}` pages and a leaderboard ranked by cumulative amount paid
- queue jumps add to both queue priority and leaderboard total
- undelivered inventory is refunded seven days after its verified purchase

The counted product link is `/r/{campaignId}`. It uses a stable anonymous visitor cookie
and a database uniqueness rule to count at most one delivered click per visitor and
campaign. Obvious bots, suspicious repeated activity, and technically reliable owner
matches are excluded; raw attempts remain available for diagnostics. See
[`docs/click-accounting.md`](docs/click-accounting.md) for the exact definition.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run migrate
npm run dev
```

With Lemon Squeezy variables unset, checkout uses the local completion stub. Seed visual
development data with `npm run seed:demo`.

## Deployment migration

`lib/schema.sql` migrates legacy permanent listings into delivered campaigns and then
removes the retired scheduling tables. Take a backup first and pause new purchases while
the migration and application deploy cross over:

```bash
npm run backup
npm run migrate
```

The webhook must point to `/api/webhooks/lemonsqueezy`. The provider variant must allow
custom prices including 500 cents. The checkout sends integer-cent `custom_price` values.

`/api/cron/tick` expires abandoned checkout holds, reconciles partial refunds, and
recomputes the supply cap once per day. `vercel.json` invokes it daily at 00:17 UTC so
the project can deploy on Vercel Hobby. For tighter reconciliation, an external scheduler
may call it hourly with `Authorization: Bearer $CRON_SECRET`. The cap is three times
trailing delivered volume with a floor of 250 clicks, so every advertised package can
be purchased when the queue is otherwise empty.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Before production, also create a $5 checkout against the Lemon Squeezy test store and
complete it to confirm the configured variant's custom-price minimum.
