-- yourhour.lol guaranteed-click campaign schema.
-- All timestamps are UTC and all money is stored in integer cents.
-- Run with `npm run migrate` during the purchase-only maintenance window.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE campaign_status AS ENUM ('queued', 'live', 'delivered');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS campaigns (
  id                    bigserial PRIMARY KEY,
  slug                  text NOT NULL,
  url                   text NOT NULL,
  product_name          text NOT NULL,
  pitch                 text CHECK (pitch IS NULL OR char_length(pitch) <= 180),
  icon_url              text,
  clicks_purchased      integer NOT NULL CHECK (clicks_purchased >= 0),
  clicks_delivered      integer NOT NULL DEFAULT 0 CHECK (clicks_delivered >= 0),
  bonus_clicks          integer NOT NULL DEFAULT 0 CHECK (bonus_clicks >= 0),
  accounting_status     text NOT NULL DEFAULT 'verified'
                          CHECK (accounting_status IN ('verified','manual_reconciled','legacy_total_only')),
  purchased_clicks      integer CHECK (purchased_clicks IS NULL OR purchased_clicks >= 0),
  guaranteed_clicks_delivered integer CHECK (guaranteed_clicks_delivered IS NULL OR guaranteed_clicks_delivered >= 0),
  bonus_clicks_delivered integer NOT NULL DEFAULT 0 CHECK (bonus_clicks_delivered >= 0),
  historical_clicks_delivered integer NOT NULL DEFAULT 0 CHECK (historical_clicks_delivered >= 0),
  bonus_round_clicks_delivered integer NOT NULL DEFAULT 0 CHECK (bonus_round_clicks_delivered >= 0),
  total_clicks_delivered integer GENERATED ALWAYS AS (
    COALESCE(guaranteed_clicks_delivered, 0) + bonus_clicks_delivered + historical_clicks_delivered
  ) STORED,
  bonus_click_cap       integer CHECK (bonus_click_cap IS NULL OR bonus_click_cap >= 0),
  clicks_refunded       integer NOT NULL DEFAULT 0 CHECK (clicks_refunded >= 0),
  amount_paid_cents     integer NOT NULL CHECK (amount_paid_cents >= 0),
  priority_cents        integer NOT NULL DEFAULT 0 CHECK (priority_cents >= 0),
  status                campaign_status NOT NULL DEFAULT 'queued',
  owner_token_hash      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  delivered_at          timestamptz,
  CHECK (bonus_clicks <= clicks_delivered),
  CHECK (bonus_click_cap IS NULL OR bonus_clicks <= bonus_click_cap),
  CHECK (clicks_delivered - bonus_clicks <= clicks_purchased),
  CHECK (clicks_refunded <= clicks_purchased - (clicks_delivered - bonus_clicks))
);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bonus_clicks integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bonus_click_cap integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS accounting_status text NOT NULL DEFAULT 'verified';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS purchased_clicks integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS guaranteed_clicks_delivered integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bonus_clicks_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS historical_clicks_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bonus_round_clicks_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_clicks_delivered integer GENERATED ALWAYS AS (
  COALESCE(guaranteed_clicks_delivered, 0) + bonus_clicks_delivered + historical_clicks_delivered
) STORED;

CREATE TABLE IF NOT EXISTS campaign_accounting_audits (
  id             bigserial PRIMARY KEY,
  campaign_id    bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  reason_code    text NOT NULL,
  reason         text NOT NULL,
  provenance     text NOT NULL,
  before_values  jsonb NOT NULL,
  after_values   jsonb NOT NULL,
  corrected_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, reason_code)
);

-- The time-based product stored traffic earned, not clicks purchased. Preserve the
-- verifiable total and any bonus-round clicks recorded after the conversion, but do
-- not manufacture a guaranteed-purchase quantity from the amount paid.
UPDATE campaigns
   SET accounting_status = 'legacy_total_only',
       purchased_clicks = NULL,
       guaranteed_clicks_delivered = NULL,
       historical_clicks_delivered = GREATEST(0, clicks_delivered - bonus_clicks),
       bonus_clicks_delivered = bonus_clicks,
       bonus_round_clicks_delivered = bonus_clicks
 WHERE status = 'delivered'
   AND started_at IS NULL
   AND delivered_at IS NULL
   -- Screenwar has a dedicated audited correction below. Reclassifying it here on a
   -- rerun would temporarily put 79 historical bonus clicks against its 33-click
   -- operational bonus cap and fail before the correction can be applied.
   AND slug <> 'screenwar';

-- All non-legacy campaigns were created by the guaranteed-click checkout and can be
-- mapped without inference.
UPDATE campaigns
   SET accounting_status = 'verified',
       purchased_clicks = clicks_purchased,
       guaranteed_clicks_delivered = GREATEST(0, clicks_delivered - bonus_clicks),
       historical_clicks_delivered = 0,
       bonus_clicks_delivered = bonus_clicks,
       bonus_round_clicks_delivered = bonus_clicks
 WHERE NOT (status = 'delivered' AND started_at IS NULL AND delivered_at IS NULL)
   AND (purchased_clicks IS NULL OR guaranteed_clicks_delivered IS NULL);

-- Screenwar is the one legacy record whose split was confirmed by the product owner.
-- Record the exact before/after snapshot before applying the idempotent correction.
INSERT INTO campaign_accounting_audits
  (campaign_id, reason_code, reason, provenance, before_values, after_values)
SELECT id,
       'screenwar-launch-customer-2026-08-24',
       'Correct the launch customer guarantee while preserving the confirmed total.',
       'Owner-confirmed launch customer correction dated 2026-08-24',
       jsonb_build_object(
         'clicksPurchased', clicks_purchased,
         'clicksDelivered', clicks_delivered,
         'bonusClicks', bonus_clicks,
         'amountPaidCents', amount_paid_cents
       ),
       jsonb_build_object(
         'purchasedClicks', 25,
         'guaranteedClicksDelivered', 25,
         'bonusClicksDelivered', 74,
         'totalClicksDelivered', 99
       )
  FROM campaigns
 WHERE slug = 'screenwar'
ON CONFLICT (campaign_id, reason_code) DO NOTHING;

UPDATE campaigns
   SET accounting_status = 'manual_reconciled',
       purchased_clicks = 25,
       guaranteed_clicks_delivered = 25,
       bonus_clicks_delivered = 74,
       historical_clicks_delivered = 0,
       bonus_round_clicks_delivered = 33,
       clicks_purchased = 25,
       clicks_delivered = 99,
       bonus_clicks = 74,
       bonus_click_cap = GREATEST(COALESCE(bonus_click_cap, 0), 74)
 WHERE slug = 'screenwar';
DO $$
DECLARE old_check record;
BEGIN
  FOR old_check IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'campaigns'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ~ 'clicks_delivered[^)]*<= clicks_purchased'
         OR pg_get_constraintdef(oid) ~ 'clicks_refunded[^)]*<= \(clicks_purchased - clicks_delivered\)'
       )
  LOOP
    EXECUTE format('ALTER TABLE campaigns DROP CONSTRAINT %I', old_check.conname);
  END LOOP;
END $$;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_clicks_delivered_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_clicks_refunded_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_bonus_clicks_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_bonus_click_cap_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_guaranteed_clicks_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_refundable_clicks_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_bonus_clicks_check
  CHECK (bonus_clicks >= 0 AND bonus_clicks <= clicks_delivered);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_bonus_click_cap_check
  CHECK (bonus_click_cap IS NULL OR (bonus_click_cap >= 0 AND bonus_round_clicks_delivered <= bonus_click_cap));
ALTER TABLE campaigns ADD CONSTRAINT campaigns_guaranteed_clicks_check
  CHECK (clicks_delivered - bonus_clicks <= clicks_purchased);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_refundable_clicks_check
  CHECK (clicks_refunded <= clicks_purchased - (clicks_delivered - bonus_clicks));
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_accounting_status_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_verified_accounting_check;
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_legacy_accounting_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_accounting_status_check
  CHECK (accounting_status IN ('verified','manual_reconciled','legacy_total_only'));
ALTER TABLE campaigns ADD CONSTRAINT campaigns_verified_accounting_check
  CHECK (
    accounting_status = 'legacy_total_only'
    OR (
      purchased_clicks IS NOT NULL
      AND guaranteed_clicks_delivered IS NOT NULL
      AND historical_clicks_delivered = 0
      AND guaranteed_clicks_delivered <= purchased_clicks
      AND clicks_refunded <= purchased_clicks - guaranteed_clicks_delivered
    )
  );
ALTER TABLE campaigns ADD CONSTRAINT campaigns_legacy_accounting_check
  CHECK (
    accounting_status <> 'legacy_total_only'
    OR (purchased_clicks IS NULL AND guaranteed_clicks_delivered IS NULL)
  );

-- The old compatibility constraint has now been replaced with an operational bonus
-- cap, so Screenwar's confirmed 74 historical bonus clicks no longer inflate it.
UPDATE campaigns
   SET bonus_click_cap = GREATEST(33, bonus_round_clicks_delivered)
 WHERE slug = 'screenwar';

CREATE UNIQUE INDEX IF NOT EXISTS campaigns_slug_idx ON campaigns (slug);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_live_idx
  ON campaigns ((1)) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS campaigns_queue_idx
  ON campaigns (priority_cents DESC, created_at ASC, id ASC) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS campaigns_rank_idx
  ON campaigns (amount_paid_cents DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);

-- One durable row per attempted payment. Completed click purchases double as the
-- refund ledger; jump and leaderboard payments are deliberately never refundable by
-- the delivery guarantee.
CREATE TABLE IF NOT EXISTS checkout_intents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                   text NOT NULL CHECK (mode IN ('purchase','jump')),
  campaign_id            bigint REFERENCES campaigns(id) ON DELETE CASCADE,
  clicks_delta           integer NOT NULL DEFAULT 0 CHECK (clicks_delta >= 0),
  expected_amount_cents  integer NOT NULL CHECK (expected_amount_cents > 0),
  target_amount_cents    integer,
  target_priority_cents  integer,
  display_name           text,
  url                    text,
  pitch                  text CHECK (pitch IS NULL OR char_length(pitch) <= 180),
  icon_url               text,
  owner_token_hash       text,
  purchase_ip_hash       text,
  visitor_id             uuid,
  twclid                 text,
  attribution            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','completed','expired')),
  expires_at             timestamptz NOT NULL,
  ls_checkout_url        text,
  ls_order_id            text UNIQUE,
  provider_subtotal_cents integer,
  provider_total_cents   integer,
  provider_currency      text,
  provider_test_mode     boolean,
  delivery_deadline      timestamptz,
  guaranteed_clicks_delivered integer NOT NULL DEFAULT 0 CHECK (guaranteed_clicks_delivered >= 0),
  guaranteed_clicks_refunded integer NOT NULL DEFAULT 0 CHECK (guaranteed_clicks_refunded >= 0),
  refund_target_cents    integer NOT NULL DEFAULT 0 CHECK (refund_target_cents >= 0),
  refunded_cents         integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  refund_lock_until      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  completed_at           timestamptz
);

CREATE INDEX IF NOT EXISTS checkout_intents_pending_idx
  ON checkout_intents (expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS checkout_intents_campaign_idx
  ON checkout_intents (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS checkout_intents_refunds_idx
  ON checkout_intents (campaign_id)
  WHERE refund_target_cents > refunded_cents;

ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS refund_lock_until timestamptz;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS visitor_id uuid;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS attribution jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS provider_subtotal_cents integer;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS provider_currency text;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS provider_test_mode boolean;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS delivery_deadline timestamptz;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS guaranteed_clicks_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS guaranteed_clicks_refunded integer NOT NULL DEFAULT 0;
ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_delivery_accounting_check;
ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_delivery_accounting_check
  CHECK (guaranteed_clicks_delivered + guaranteed_clicks_refunded <= clicks_delta);

UPDATE checkout_intents i
   SET delivery_deadline = COALESCE(i.delivery_deadline, i.completed_at + interval '7 days'),
       guaranteed_clicks_delivered = CASE
         WHEN c.accounting_status IN ('verified','manual_reconciled')
              AND c.status = 'delivered' AND i.clicks_delta > 0
           THEN i.clicks_delta
         ELSE i.guaranteed_clicks_delivered
       END
  FROM campaigns c
 WHERE i.campaign_id = c.id AND i.mode = 'purchase' AND i.status = 'completed';

-- Retire pending rows from the former standalone leaderboard payment mode. Completed
-- historical rows remain valid receipts. Keep the constraint compatible with both
-- those historical modes and the current bid mode so rerunning this schema never
-- rejects checkout rows created by a newer release.
UPDATE checkout_intents
   SET status = 'expired'
 WHERE mode = 'rank_boost' AND status = 'pending';

ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_mode_check;
ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_mode_check
  CHECK (mode IN ('purchase','jump','rank_boost','bid'));

-- The hour bucket is strictly a click-dedupe window, not a purchasable time unit.
CREATE TABLE IF NOT EXISTS campaign_clicks (
  id           bigserial PRIMARY KEY,
  campaign_id  bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ip_hash      text NOT NULL,
  visitor_id   uuid,
  hour_bucket  timestamptz NOT NULL,
  is_bonus     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_clicks ADD COLUMN IF NOT EXISTS is_bonus boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_clicks ADD COLUMN IF NOT EXISTS visitor_id uuid;
ALTER TABLE campaign_clicks ADD COLUMN IF NOT EXISTS id bigserial;
ALTER TABLE campaign_clicks DROP CONSTRAINT IF EXISTS campaign_clicks_pkey;
ALTER TABLE campaign_clicks ADD CONSTRAINT campaign_clicks_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS campaign_clicks_created_idx ON campaign_clicks (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_clicks_campaign_visitor_idx
  ON campaign_clicks (campaign_id, visitor_id) WHERE visitor_id IS NOT NULL;

-- Every outbound attempt is retained for diagnostics. Only a row linked from
-- campaign_clicks has affected a delivered counter.
CREATE TABLE IF NOT EXISTS campaign_click_events (
  id              bigserial PRIMARY KEY,
  campaign_id     bigint REFERENCES campaigns(id) ON DELETE SET NULL,
  visitor_id      uuid,
  ip_hash         text NOT NULL,
  user_agent      text,
  bonus_requested boolean NOT NULL DEFAULT false,
  outcome         text NOT NULL CHECK (
                    outcome IN ('counted_guaranteed','counted_bonus','duplicate','bot',
                                'owner','rate_limited','not_active','not_found','error')
                  ),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_click_events_visitor_rate_idx
  ON campaign_click_events (visitor_id, created_at DESC) WHERE visitor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_click_events_ip_rate_idx
  ON campaign_click_events (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_click_events_campaign_idx
  ON campaign_click_events (campaign_id, created_at DESC);

-- Canonical funnel ledger. The unique key is local idempotency; Vemetric and X are
-- downstream views of these rows rather than independent sources of truth.
CREATE TABLE IF NOT EXISTS analytics_events (
  id                  bigserial PRIMARY KEY,
  event_name          text NOT NULL,
  idempotency_key     text NOT NULL,
  visitor_id          uuid,
  campaign_id         bigint REFERENCES campaigns(id) ON DELETE SET NULL,
  checkout_intent_id  uuid REFERENCES checkout_intents(id) ON DELETE SET NULL,
  order_id            text,
  event_data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  vemetric_sent_at    timestamptz,
  x_sent_at           timestamptz,
  delivery_attempts   integer NOT NULL DEFAULT 0,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS analytics_events_pending_idx
  ON analytics_events (created_at)
  WHERE vemetric_sent_at IS NULL OR (event_name = 'purchase_completed' AND x_sent_at IS NULL);

-- Anonymous browser-backed visitors power the cumulative since-launch count. This is
-- deliberately independent from campaign delivery and stores no network address.
CREATE TABLE IF NOT EXISTS visitors (
  id             uuid PRIMARY KEY,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors (last_seen_at);

-- A boolean primary key makes this a real singleton without relying on application code.
CREATE TABLE IF NOT EXISTS site_config (
  singleton                  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  click_rate_cents           integer NOT NULL DEFAULT 20 CHECK (click_rate_cents = 20),
  max_outstanding_clicks     integer NOT NULL DEFAULT 250 CHECK (max_outstanding_clicks >= 250),
  cap_recomputed_at          timestamptz NOT NULL DEFAULT now()
);

-- Keep the singleton aligned when this schema is applied to an existing database.
ALTER TABLE site_config DROP CONSTRAINT IF EXISTS site_config_click_rate_cents_check;
ALTER TABLE site_config DROP CONSTRAINT IF EXISTS site_config_max_outstanding_clicks_check;
ALTER TABLE site_config ALTER COLUMN click_rate_cents SET DEFAULT 20;
ALTER TABLE site_config ALTER COLUMN max_outstanding_clicks SET DEFAULT 250;
UPDATE site_config SET click_rate_cents = 20 WHERE singleton = true;
UPDATE site_config SET max_outstanding_clicks = GREATEST(max_outstanding_clicks, 250) WHERE singleton = true;
ALTER TABLE site_config ADD CONSTRAINT site_config_click_rate_cents_check
  CHECK (click_rate_cents = 20);
ALTER TABLE site_config ADD CONSTRAINT site_config_max_outstanding_clicks_check
  CHECK (max_outstanding_clicks >= 250);

INSERT INTO site_config (singleton, click_rate_cents, max_outstanding_clicks)
VALUES (true, 20, 250)
ON CONFLICT (singleton) DO NOTHING;

-- Preserve every permanent listing from the previous Wall as a delivered legacy
-- campaign. Dynamic SQL keeps this migration parseable on a fresh database where the
-- retired tables never existed.
DO $$ BEGIN
  IF to_regclass('public.wall_entries') IS NOT NULL THEN
    EXECUTE $backfill$
      INSERT INTO campaigns
        (id, slug, url, product_name, pitch, icon_url, clicks_purchased,
         clicks_delivered, amount_paid_cents, priority_cents, status, created_at)
      SELECT e.id,
             COALESCE(e.slug, 'legacy-' || e.id::text),
             COALESCE(e.url, 'https://yourhour.lol/u/' || COALESCE(e.slug, 'legacy-' || e.id::text)),
             COALESCE(NULLIF(btrim(e.display_name), ''), 'Legacy product'),
             e.pitch,
             e.image_url,
             GREATEST(0, e.clicks + COALESCE(s.slot_clicks, 0)),
             GREATEST(0, e.clicks + COALESCE(s.slot_clicks, 0)),
             GREATEST(0, e.amount_paid),
             0,
             'delivered'::campaign_status,
             e.created_at
        FROM wall_entries e
        LEFT JOIN LATERAL (
          SELECT COALESCE(sum(clicks), 0)::int AS slot_clicks
            FROM slots WHERE wall_entry_id = e.id
        ) s ON true
      ON CONFLICT (id) DO NOTHING
    $backfill$;

    IF to_regclass('public.reservations') IS NOT NULL THEN
      EXECUTE $intents$
        INSERT INTO checkout_intents
          (id, mode, campaign_id, clicks_delta, expected_amount_cents,
           display_name, url, pitch, icon_url, status, expires_at, ls_order_id,
           provider_total_cents, created_at, completed_at)
        SELECT r.id, 'purchase', r.wall_entry_id, 0,
               GREATEST(1, COALESCE(r.amount, e.amount_paid, 1)),
               r.display_name, r.url, r.pitch, r.image_url,
               CASE WHEN r.status = 'completed' THEN 'completed' ELSE 'expired' END,
               r.expires_at, e.ls_order_id, r.amount, r.created_at,
               CASE WHEN r.status = 'completed' THEN r.created_at ELSE NULL END
          FROM reservations r
          LEFT JOIN wall_entries e ON e.id = r.wall_entry_id
         WHERE r.wall_entry_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING
      $intents$;
    END IF;

    IF to_regclass('public.wall_clicks') IS NOT NULL THEN
      EXECUTE $wallclicks$
        INSERT INTO campaign_clicks (campaign_id, ip_hash, hour_bucket, created_at)
        SELECT wc.entry_id, wc.ip_hash, date_trunc('hour', wc.created_at), wc.created_at
          FROM wall_clicks wc
          JOIN campaigns c ON c.id = wc.entry_id
        ON CONFLICT DO NOTHING
      $wallclicks$;
    END IF;

    IF to_regclass('public.clicks') IS NOT NULL AND to_regclass('public.slots') IS NOT NULL THEN
      EXECUTE $slotclicks$
        INSERT INTO campaign_clicks (campaign_id, ip_hash, hour_bucket, created_at)
        SELECT s.wall_entry_id, c.ip_hash, date_trunc('hour', c.created_at), c.created_at
          FROM clicks c
          JOIN slots s ON s.id = c.slot_id
          JOIN campaigns cp ON cp.id = s.wall_entry_id
         WHERE s.wall_entry_id IS NOT NULL
        ON CONFLICT DO NOTHING
      $slotclicks$;
    END IF;
  END IF;
END $$;

SELECT setval(
  pg_get_serial_sequence('campaigns', 'id'),
  COALESCE((SELECT max(id) FROM campaigns), 1),
  EXISTS (SELECT 1 FROM campaigns)
);

-- Contraction: the new application has no reads or writes against the retired model.
DROP TABLE IF EXISTS reservation_slots CASCADE;
DROP TABLE IF EXISTS clicks CASCADE;
DROP TABLE IF EXISTS wall_clicks CASCADE;
DROP TABLE IF EXISTS reservations CASCADE;
DROP TABLE IF EXISTS slots CASCADE;
DROP TABLE IF EXISTS wall_entries CASCADE;
DROP TABLE IF EXISTS visit_hours CASCADE;
DROP TABLE IF EXISTS counters CASCADE;
DROP SEQUENCE IF EXISTS claim_number_seq;
DROP TYPE IF EXISTS slot_status;
DROP TYPE IF EXISTS wall_kind;

-- Permanent paid leaderboard migration (2026-08-25).
-- Keep the delivery-era columns for a rollback window, but the application now reads
-- only the canonical bid and verified-click fields below.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS normalized_domain text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bid_cents integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS verified_clicks integer;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bid_placed_at timestamptz;

CREATE TABLE IF NOT EXISTS leaderboard_migration_audits (
  campaign_id                 bigint PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  original_amount_paid_cents  integer NOT NULL,
  normalized_bid_cents        integer NOT NULL,
  original_rank               integer NOT NULL,
  original_clicks             integer NOT NULL,
  migrated_at                 timestamptz NOT NULL DEFAULT now()
);

WITH legacy_rank AS (
  SELECT id, amount_paid_cents,
         GREATEST(100, ceil(amount_paid_cents / 100.0)::int * 100) AS normalized_bid,
         row_number() OVER (ORDER BY amount_paid_cents DESC, created_at ASC, id ASC)::int AS original_rank,
         total_clicks_delivered AS original_clicks
    FROM campaigns
   WHERE bid_cents IS NULL
)
INSERT INTO leaderboard_migration_audits
  (campaign_id, original_amount_paid_cents, normalized_bid_cents, original_rank, original_clicks)
SELECT id, amount_paid_cents, normalized_bid, original_rank, original_clicks FROM legacy_rank
ON CONFLICT (campaign_id) DO NOTHING;

UPDATE campaigns c
   SET normalized_domain = lower(regexp_replace(regexp_replace(regexp_replace(
         split_part(regexp_replace(c.url, '^https?://', '', 'i'), '/', 1),
         '^.*@', ''), '^www\.', '', 'i'), ':[0-9]+$', '')),
       bid_cents = a.normalized_bid_cents,
       verified_clicks = a.original_clicks,
       -- Unique rank-based timestamps preserve the exact old order inside rounded ties.
       bid_placed_at = timestamptz '2000-01-01 00:00:00+00' + (a.original_rank || ' seconds')::interval
  FROM leaderboard_migration_audits a
 WHERE a.campaign_id = c.id
   AND (c.bid_cents IS NULL OR c.verified_clicks IS NULL OR c.bid_placed_at IS NULL OR c.normalized_domain IS NULL);

ALTER TABLE campaigns ALTER COLUMN normalized_domain SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN bid_cents SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN verified_clicks SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN verified_clicks SET DEFAULT 0;
ALTER TABLE campaigns ALTER COLUMN bid_placed_at SET NOT NULL;
ALTER TABLE campaigns ALTER COLUMN bid_placed_at SET DEFAULT now();
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_bid_cents_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_bid_cents_check
  CHECK (bid_cents >= 100 AND bid_cents <= 1000000 AND bid_cents % 100 = 0);
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_verified_clicks_check;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_verified_clicks_check CHECK (verified_clicks >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_normalized_domain_idx ON campaigns (normalized_domain);
CREATE INDEX IF NOT EXISTS campaigns_bid_rank_idx ON campaigns (bid_cents DESC, bid_placed_at ASC, id ASC);

-- Owner-authorized promotional credit for whoisnext.lol. The customer paid $5 for
-- the previous guaranteed-click product, but is displayed at $7 on the leaderboard
-- so the remaining 25-click obligation starts from the homepage. Keep the actual
-- historical payment untouched, and never reduce a later paid upgrade.
UPDATE campaigns
   SET bid_cents = GREATEST(bid_cents, 700)
 WHERE normalized_domain = 'whoisnext.lol'
   AND amount_paid_cents = 500;

-- One-time editorial correction for the legacy Safe Elephant listing. Its scraped
-- description used to contain the current owner's social link, which is not product
-- information and must not follow the listing into the permanent leaderboard.
UPDATE campaigns
   SET product_name = 'Most expensive link',
       pitch = 'The most expensive link on the internet.'
 WHERE normalized_domain = 'safeelephant.co.uk';

-- Normalize legacy domain-style names using the same conservative word splits used
-- for new submissions. Descriptions and all payment/click data remain untouched.
UPDATE campaigns SET product_name = 'Who is next'
 WHERE normalized_domain = 'whoisnext.lol';
UPDATE campaigns SET product_name = 'Screen war'
 WHERE normalized_domain IN ('screenwar.lol', 'screenwar.app');

-- These legacy rows predate icon scraping. Use the square icons declared by each
-- product instead of Google's successful-but-generic globe favicon response.
UPDATE campaigns SET icon_url = 'https://whoisnext.lol/apple-touch-icon.png'
 WHERE normalized_domain = 'whoisnext.lol' AND icon_url IS NULL;
UPDATE campaigns SET icon_url = 'https://screenwar.lol/coin.png'
 WHERE normalized_domain IN ('screenwar.lol', 'screenwar.app') AND icon_url IS NULL;

ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS target_bid_cents integer;
ALTER TABLE checkout_intents ADD COLUMN IF NOT EXISTS normalized_domain text;
ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_mode_check;
ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_mode_check CHECK (mode IN ('purchase','jump','rank_boost','bid'));
ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_target_bid_check;
ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_target_bid_check
  CHECK (target_bid_cents IS NULL OR (target_bid_cents >= 300 AND target_bid_cents <= 1000000 AND target_bid_cents % 100 = 0));
UPDATE checkout_intents SET status = 'expired' WHERE mode IN ('purchase','jump') AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_one_pending_domain_idx
  ON checkout_intents (normalized_domain) WHERE mode = 'bid' AND status = 'pending';

ALTER TABLE campaign_click_events DROP CONSTRAINT IF EXISTS campaign_click_events_outcome_check;
ALTER TABLE campaign_click_events ADD CONSTRAINT campaign_click_events_outcome_check CHECK (
  outcome IN ('counted','counted_guaranteed','counted_bonus','duplicate','bot','owner',
              'rate_limited','not_active','not_found','error')
);
