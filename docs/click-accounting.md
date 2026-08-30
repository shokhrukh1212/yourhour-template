# Verified leaderboard clicks

A click is added when a request to `/r/:listingId` meets every condition below:

1. The request has a stable anonymous `yourhour_visitor` UUID cookie.
2. That visitor has not previously added a click to the same product. PostgreSQL enforces unique `(campaign_id, visitor_id)` values.
3. The request is not an obvious crawler, link-preview fetch, or prefetch.
4. It stays below the rolling ten-minute limits of five attempts per visitor and twenty per hashed network address.
5. It is not identified as the product owner by the private owner cookie or the hashed network address recorded at verified checkout.

The redirect still works when an attempt is excluded. Every attempt stores a diagnostic outcome in `campaign_click_events`; raw IP addresses and device fingerprints are never stored.

`campaigns.verified_clicks` is the public canonical counter. During migration it is backfilled from the previously verified `total_clicks_delivered`, preserving all historical totals. New eligible visits increment it only after the visitor/product uniqueness insert succeeds.

Owner exclusion is best-effort. An owner on a new browser and network cannot be identified reliably without invasive tracking, which YourHour does not use.

Sponsored placements use the separate `/s/:sponsorshipId` redirect. Eligible
requests increment `sponsorships.click_count` and write a
`sponsorship_click_events` row with either `sponsor_desktop` or `sponsor_mobile`.
Those events never increment `campaigns.verified_clicks` and never affect rank.
