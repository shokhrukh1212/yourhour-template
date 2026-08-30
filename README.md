# YourHour

YourHour is a permanent product leaderboard. Pay less, get more: #1 takes the homepage, and every completed buyer remains listed forever.

## Product model

- the first product bids $3
- bids are whole US dollars
- paying $1 more than a product beats that position
- the same domain maps to one listing
- an owner upgrading an existing listing pays only the difference
- rank is calculated when payment completes; checkout does not reserve a position
- completed bids are final and non-refundable
- outbound visits use `/r/{listingId}` and count once per eligible visitor per product

Legacy guaranteed-click payments are preserved in `leaderboard_migration_audits` before being rounded up to whole-dollar leaderboard totals. The old delivery columns remain temporarily for rollback but are no longer used by the application.

## Local setup

```bash
npm install
cp .env.example .env.local
npm run migrate
npm run seed:demo
npm run dev
```

With Lemon Squeezy variables unset, checkout uses the local completion stub. The configured Lemon Squeezy variant must accept custom prices as low as $1 because an owner can buy a one-dollar upgrade. The webhook endpoint is `/api/webhooks/lemonsqueezy`.

The homepage also has four temporary sponsored positions. Their 7-day and 30-day
prices are configured with the server-only `SPONSOR_SLOT_{1..4}_PRICE_{7D|30D}_CENTS`
variables and `SPONSOR_CURRENCY`. Sponsorship checkout uses the same Lemon Squeezy
variant and verified webhook as leaderboard bids, but stores payments and click
tracking separately and never changes homepage or leaderboard rank.

`/api/cron/tick` expires abandoned bid intents and sponsorship reservations, expires
ended sponsorships, and retries durable analytics delivery. It does not promote
campaigns, calculate capacity, or issue refunds.

## Production migration

Back up the database and briefly pause checkout before applying the schema:

```bash
npm run backup
npm run migrate
```

Verify the migration audit, normalized totals, original tie order, and click totals before resuming checkout. Do not remove the legacy delivery columns until the new model has been stable for at least seven days.

## Verification

```bash
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

Before production launch, complete both a $3 new-listing checkout and a $1 existing-owner upgrade in the Lemon Squeezy test store.
