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
  CHECK (bonus_click_cap IS NULL OR (bonus_click_cap >= 0 AND bonus_clicks <= bonus_click_cap));
ALTER TABLE campaigns ADD CONSTRAINT campaigns_guaranteed_clicks_check
  CHECK (clicks_delivered - bonus_clicks <= clicks_purchased);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_refundable_clicks_check
  CHECK (clicks_refunded <= clicks_purchased - (clicks_delivered - bonus_clicks));

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
  twclid                 text,
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','completed','expired')),
  expires_at             timestamptz NOT NULL,
  ls_checkout_url        text,
  ls_order_id            text UNIQUE,
  provider_total_cents   integer,
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

-- Retire the former standalone leaderboard payment mode. Completed historical rows
-- remain valid receipts; when none exist, tighten the database constraint as well.
UPDATE checkout_intents
   SET status = 'expired'
 WHERE mode = 'rank_boost' AND status = 'pending';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM checkout_intents WHERE mode = 'rank_boost') THEN
    ALTER TABLE checkout_intents DROP CONSTRAINT IF EXISTS checkout_intents_mode_check;
    ALTER TABLE checkout_intents ADD CONSTRAINT checkout_intents_mode_check
      CHECK (mode IN ('purchase','jump'));
  END IF;
END $$;

-- The only click campaign sold before the August 2026 price change paid $5 for 20
-- clicks. Honor the new 20-cent rate by extending that same purchase to 25 clicks
-- without changing clicks already delivered. If it completed during deployment,
-- reopen it (or queue it when another campaign is already live).
DO $$
DECLARE
  one_hour_id bigint;
  another_live boolean;
BEGIN
  SELECT id INTO one_hour_id
    FROM campaigns
   WHERE slug = 'one-hour'
     AND lower(product_name) = 'one hour'
     AND amount_paid_cents = 500
     AND clicks_purchased = 20
   ORDER BY id DESC
   LIMIT 1
   FOR UPDATE;

  IF one_hour_id IS NOT NULL THEN
    UPDATE checkout_intents
       SET clicks_delta = 25
     WHERE campaign_id = one_hour_id
       AND mode = 'purchase'
       AND status = 'completed'
       AND expected_amount_cents = 500
       AND clicks_delta = 20;

    SELECT EXISTS (
      SELECT 1 FROM campaigns WHERE status = 'live' AND id <> one_hour_id
    ) INTO another_live;

    UPDATE campaigns
       SET clicks_purchased = 25,
           status = CASE
             WHEN another_live AND status = 'delivered' THEN 'queued'::campaign_status
             WHEN NOT another_live THEN 'live'::campaign_status
             ELSE status
           END,
           started_at = CASE WHEN NOT another_live THEN COALESCE(started_at, now()) ELSE started_at END,
           delivered_at = NULL
     WHERE id = one_hour_id;
  END IF;
END $$;

-- The hour bucket is strictly a click-dedupe window, not a purchasable time unit.
CREATE TABLE IF NOT EXISTS campaign_clicks (
  campaign_id  bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ip_hash      text NOT NULL,
  hour_bucket  timestamptz NOT NULL,
  is_bonus     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, ip_hash, hour_bucket)
);

ALTER TABLE campaign_clicks ADD COLUMN IF NOT EXISTS is_bonus boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS campaign_clicks_created_idx ON campaign_clicks (created_at);

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
  max_outstanding_clicks     integer NOT NULL DEFAULT 150 CHECK (max_outstanding_clicks >= 150),
  cap_recomputed_at          timestamptz NOT NULL DEFAULT now()
);

-- Keep the singleton aligned when this schema is applied to an existing database.
ALTER TABLE site_config DROP CONSTRAINT IF EXISTS site_config_click_rate_cents_check;
ALTER TABLE site_config ALTER COLUMN click_rate_cents SET DEFAULT 20;
UPDATE site_config SET click_rate_cents = 20 WHERE singleton = true;
ALTER TABLE site_config ADD CONSTRAINT site_config_click_rate_cents_check
  CHECK (click_rate_cents = 20);

INSERT INTO site_config (singleton, click_rate_cents, max_outstanding_clicks)
VALUES (true, 20, 150)
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
