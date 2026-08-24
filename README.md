# yourhour

One product owns the homepage until its guaranteed outbound clicks are delivered.

## Product model

- 20¢ per counted outbound click (`CLICK_RATE_CENTS` in `lib/pricing.ts`)
- custom orders start at 25 clicks / $5; 250-click maximum per purchase
- packages of 50, 100, 200 and 250, plus custom whole-click amounts
- one live campaign; remaining campaigns ordered by paid priority then creation date
- permanent `/u/{slug}` pages and a leaderboard ranked by cumulative amount paid
- queue jumps add to both queue priority and leaderboard total
- undelivered inventory is refunded seven days after a campaign starts

The counted product link is `/r/{campaignId}`. It deduplicates by hashed IP and campaign
within a UTC bucket, excludes the buyer's recorded purchase IP, and promotes the next
campaign synchronously when the final click lands.

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

`/api/cron/tick` should run hourly with `Authorization: Bearer $CRON_SECRET`. It expires
abandoned checkout holds, reconciles partial refunds, and recomputes the supply cap once
per day. The cap is three times trailing delivered volume with a floor of 150 clicks.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Before production, also create a $5 checkout against the Lemon Squeezy test store and
complete it to confirm the configured variant's custom-price minimum.
