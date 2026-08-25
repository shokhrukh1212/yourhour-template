# Click accounting and delivery

## Valid delivered click

A guaranteed click is added only when a request to `/r/:campaignId` meets every condition below:

1. The campaign is live and still has unfulfilled guaranteed inventory.
2. The request has a stable, non-fingerprinted `yourhour_visitor` UUID cookie.
3. That visitor UUID has not previously produced a counted click for the campaign. The database enforces this with a unique `(campaign_id, visitor_id)` index.
4. The user agent is not an obvious crawler, link-preview fetcher, or prefetch request.
5. The request is below the rolling ten-minute limits (five attempts per visitor and twenty per hashed network address).
6. The visitor is not identified as the owner by the owner cookie or by the hashed network address stored when a verified checkout was created.

The redirect still works when a click is duplicate or invalid; only the delivery counter is protected. Every attempt is retained in `campaign_click_events` with its outcome for diagnostics. Raw IP addresses are never stored, and no device fingerprint is created.

Owner exclusion is best-effort: an owner using a new device and network without the owner cookie cannot be identified reliably without invasive tracking, which YourHour does not use.

## Accounting fields

- `purchased_clicks`: verified guaranteed inventory purchased through checkout.
- `guaranteed_clicks_delivered`: valid clicks allocated to that inventory.
- `bonus_clicks_delivered`: valid clicks delivered after guaranteed inventory, clearly non-guaranteed.
- `historical_clicks_delivered`: preserved traffic totals from the retired time-based product when no verified purchase split exists.
- `total_clicks_delivered`: database-generated sum of guaranteed, bonus, and historical totals.
- `bonus_round_clicks_delivered`: operational bonus-round counter, separate from audited historical bonus totals.

`Screenwar` is an audited manual reconciliation: purchased 25, guaranteed delivered 25, bonus 74, total 99. Other ambiguous legacy rows remain `legacy_total_only`; the UI does not invent purchased or bonus quantities for them.

## Deadline and refunds

Each completed purchase intent receives `delivery_deadline = completed_at + 7 days`. Valid clicks are allocated FIFO to completed purchase intents. The hourly maintenance job creates a proportional, idempotent refund target for each overdue intent, and the existing Lemon Squeezy reconciler sends only the outstanding difference. Provider order IDs and intent refund ledgers prevent webhook or cron retries from applying twice.
