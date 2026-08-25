# Buyer funnel analytics

The database `analytics_events` ledger is the idempotent source for analytics delivery. Vemetric and X receive downstream copies; Lemon Squeezy remains the revenue source of truth.

The buyer funnel uses these events in order:

1. `buyer_landing_viewed`
2. `product_url_submitted`
3. `claim_opened`
4. `checkout_started`
5. `purchase_completed`

`live_product_clicked` is tracked separately for the public delivery journey.

Action IDs, checkout intent IDs, provider order IDs, and campaign/visitor pairs are used as event-specific idempotency keys. `purchase_completed` is inserted only inside the verified webhook transaction. A `/success` visit never creates a purchase record.

Event properties include click quantity, server-calculated price, currency, campaign attribution, referrer, device class, browser, and deployment-provided country. Configure the Vemetric dashboard funnel with the five events above, then expose breakdowns for `device`, `browser`, `country`, `referrer`, `utmCampaign`, and `utmContent`. Dashboard funnel creation is a one-time Vemetric workspace setting and cannot be provisioned by this repository's ingestion token.

The X Purchase event uses the provider order ID as `conversion_id`, provider total and currency, and only runs after verified payment. The server-side delivery is durably deduplicated in `analytics_events`; the success-page pixel uses the same ID and a persistent browser guard so X can deduplicate browser and server signals.
