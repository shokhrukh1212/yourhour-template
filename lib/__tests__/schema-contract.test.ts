import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../../app/api/checkout/route.ts", import.meta.url), "utf8");
const sale = readFileSync(new URL("../sale.ts", import.meta.url), "utf8");
const sponsorshipSale = readFileSync(new URL("../sponsorship-sale.ts", import.meta.url), "utf8");

test("migration archives exact legacy values before normalizing bids", () => {
  assert.match(schema, /leaderboard_migration_audits/);
  assert.match(schema, /original_amount_paid_cents/);
  assert.match(schema, /GREATEST\(100, ceil\(amount_paid_cents \/ 100\.0\)/);
  assert.match(schema, /original_rank/);
});

test("whoisnext receives its promised display credit without rewriting payment history", () => {
  assert.match(schema, /SET bid_cents = GREATEST\(bid_cents, 700\)/);
  assert.match(schema, /normalized_domain = 'whoisnext\.lol'/);
  assert.match(schema, /amount_paid_cents = 500/);
});

test("legacy domain-style product names are corrected without owner copy", () => {
  assert.match(schema, /product_name = 'Most expensive link'/);
  assert.match(schema, /pitch = 'The most expensive link on the internet\.'/);
  assert.match(schema, /product_name = 'Who is next'/);
  assert.match(schema, /product_name = 'Screen war'/);
  assert.doesNotMatch(schema, /fractechwildcat/);
});

test("legacy listings use their declared square product icons", () => {
  assert.match(schema, /whoisnext\.lol\/apple-touch-icon\.png/);
  assert.match(schema, /screenwar\.lol\/coin\.png/);
});

test("one domain has one listing and one pending bid", () => {
  assert.match(schema, /campaigns_normalized_domain_idx/);
  assert.match(schema, /checkout_intents_one_pending_domain_idx/);
  assert.match(checkout, /ownerHashesMatch/);
  assert.match(checkout, /amountDueCents/);
});

test("rerunning the migration keeps current bid checkout rows valid", () => {
  assert.match(
    schema,
    /ADD CONSTRAINT checkout_intents_mode_check\s+CHECK \(mode IN \('purchase','jump','rank_boost','bid'\)\)/,
  );
  assert.doesNotMatch(
    schema,
    /ADD CONSTRAINT checkout_intents_mode_check\s+CHECK \(mode IN \('purchase','jump'\)\)/,
  );
});

test("the same owner can resume an unchanged pending checkout", () => {
  assert.match(checkout, /ownerHashesMatch\(pendingIntent\.owner_token_hash, ownerHash\)/);
  assert.match(checkout, /pendingIntent\.target_bid_cents === input\.targetBidCents/);
  assert.match(checkout, /checkoutUrl: pendingIntent\.ls_checkout_url/);
});

test("payment completion is idempotent and determines rank", () => {
  assert.match(schema, /ls_order_id\s+text UNIQUE/);
  assert.match(sale, /WHERE i\.ls_order_id = \$1 AND i\.status = 'completed'/);
  assert.match(sale, /bid_placed_at = now\(\)/);
});

test("verified clicks stay unique per product and visitor", () => {
  assert.match(schema, /campaign_clicks_campaign_visitor_idx\s+ON campaign_clicks \(campaign_id, visitor_id\)/);
  assert.match(schema, /outcome IN \('counted'/);
});

test("sponsorship positions have one pending or active owner", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS sponsorships/);
  assert.match(schema, /sponsorships_one_position_owner_idx/);
  assert.match(schema, /status IN \('pending', 'active'\)/);
  assert.match(schema, /sponsorships_position_status_idx/);
  assert.match(schema, /sponsorships_active_dates_idx/);
  assert.match(schema, /sponsorships_checkout_session_idx/);
});

test("sponsorship activation is provider-verified and idempotent", () => {
  assert.match(schema, /provider_order_id\s+text UNIQUE/);
  assert.match(sponsorshipSale, /WHERE provider_order_id = \$1/);
  assert.match(sponsorshipSale, /SET status = 'active'/);
  assert.match(sponsorshipSale, /make_interval\(days => duration_days\)/);
});

test("sponsorship clicks retain desktop or mobile placement", () => {
  assert.match(schema, /sponsorship_click_events/);
  assert.match(schema, /'sponsor_desktop','sponsor_mobile'/);
});
