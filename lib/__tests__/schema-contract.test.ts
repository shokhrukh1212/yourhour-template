import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const xPurchase = readFileSync(new URL("../../app/success/XPurchaseEvent.tsx", import.meta.url), "utf8");
const successPage = readFileSync(new URL("../../app/success/page.tsx", import.meta.url), "utf8");
const siteHeader = readFileSync(new URL("../../components/SiteHeader.tsx", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const buyerPage = readFileSync(new URL("../../app/get-clicks/page.tsx", import.meta.url), "utf8");

test("click delivery is unique per campaign and stable visitor", () => {
  assert.match(schema, /UNIQUE INDEX IF NOT EXISTS campaign_clicks_campaign_visitor_idx\s+ON campaign_clicks \(campaign_id, visitor_id\)/);
  assert.match(schema, /campaign_click_events[\s\S]+counted_guaranteed[\s\S]+duplicate[\s\S]+bot[\s\S]+owner[\s\S]+rate_limited/);
});

test("canonical click totals keep guaranteed, bonus, and historical counts separate", () => {
  assert.match(schema, /total_clicks_delivered integer GENERATED ALWAYS AS \(\s*COALESCE\(guaranteed_clicks_delivered, 0\) \+ bonus_clicks_delivered \+ historical_clicks_delivered/);
  assert.match(schema, /'purchasedClicks', 25,[\s\S]+'guaranteedClicksDelivered', 25,[\s\S]+'bonusClicksDelivered', 74,[\s\S]+'totalClicksDelivered', 99/);
  assert.match(schema, /WHERE status = 'delivered'[\s\S]+AND slug <> 'screenwar';[\s\S]+screenwar-launch-customer-2026-08-24/);
});

test("payment and purchase analytics use durable idempotency keys", () => {
  assert.match(schema, /ls_order_id\s+text UNIQUE/);
  assert.match(schema, /UNIQUE \(event_name, idempotency_key\)/);
  assert.match(schema, /delivery_deadline\s+timestamptz/);
  assert.match(schema, /guaranteed_clicks_delivered \+ guaranteed_clicks_refunded <= clicks_delta/);
});

test("database capacity can admit every advertised package", () => {
  assert.match(schema, /max_outstanding_clicks\s+integer NOT NULL DEFAULT 250 CHECK \(max_outstanding_clicks >= 250\)/);
  assert.match(schema, /GREATEST\(max_outstanding_clicks, 250\)/);
});

test("the success page cannot prove payment and the browser Purchase event is refresh-safe", () => {
  assert.match(successPage, /row\.status !== "completed" \|\| !row\.ls_order_id/);
  assert.match(xPurchase, /localStorage\.getItem\(flag\)/);
  assert.match(xPurchase, /conversion_id: conversionId/);
});

test("header and page counters share the live click and visitor providers", () => {
  assert.match(siteHeader, /const \{ deliveredTotal \} = useClicks\(\)/);
  assert.match(siteHeader, /const visitorTotal = useVisitors\(\)/);
  assert.match(homePage, /<VisitorsProvider initial=\{visitorTotal\}>[\s\S]+<ClicksProvider/);
  assert.match(buyerPage, /<VisitorsProvider initial=\{visitorTotal\}>[\s\S]+<ClicksProvider/);
});
