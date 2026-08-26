# Bid funnel analytics

`analytics_events` is the idempotent local ledger. Vemetric and X receive downstream copies; Lemon Squeezy is the revenue source of truth.

The bid funnel is:

1. `product_url_submitted`
2. `claim_opened`
3. `checkout_started`
4. `purchase_completed`

`live_product_clicked` records eligible outbound product visits separately. Action IDs, checkout intent IDs, provider order IDs, and listing/visitor pairs are the event-specific idempotency keys. A purchase is inserted only inside the verified webhook transaction; loading the homepage payment status never proves a payment.

Bid events contain the target total, amount charged, currency, attribution, referrer, device, browser, and deployment-provided country. Existing listing owners are charged only the target/current difference, so revenue reporting must use `priceCents` or the provider total rather than the target total.

The server sends X Purchase only after verified payment and uses the provider order ID as `conversion_id`. Pending downstream deliveries are retried by `/api/cron/tick`.
