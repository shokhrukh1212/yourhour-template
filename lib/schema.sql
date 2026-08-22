-- yourhour.lol schema
-- All timestamps UTC. All money in integer cents.
--
-- Re-run in full by `npm run migrate`, so every statement here must be idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE slot_status AS ENUM ('open','reserved','sold','past');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- THE WALL. One row per purchase, permanent, ranked by amount_paid. This owns the
-- slug, the public page, and the rank -- the slot does not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wall_entries (
  id           bigserial PRIMARY KEY,
  amount_paid  integer NOT NULL,
  display_name text,
  url          text,
  pitch        text CHECK (pitch IS NULL OR char_length(pitch) <= 120),
  slug         text,
  -- Clicks arriving through /w/{id} (the Wall and the permanent page). Clicks earned
  -- during the buyer's own hour live on the slot, so an hour row never stops meaning
  -- "clicks earned during that hour".
  clicks       integer NOT NULL DEFAULT 0,
  ls_order_id  text UNIQUE,                     -- webhook idempotency key
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Historical: how a pre-Wall slot row was linked to the entry backfilled from it.
  source_slot_id bigint
);

CREATE UNIQUE INDEX IF NOT EXISTS wall_entries_slug_idx
  ON wall_entries (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS wall_entries_rank_idx
  ON wall_entries (amount_paid DESC, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS wall_entries_source_slot_idx
  ON wall_entries (source_slot_id) WHERE source_slot_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The calendar. One row per clock hour; starts_at is always exactly on the hour, UTC.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS slots (
  id            bigserial PRIMARY KEY,
  starts_at     timestamptz NOT NULL UNIQUE,
  status        slot_status NOT NULL DEFAULT 'open',
  display_name  text,
  url           text,
  pitch         text CHECK (pitch IS NULL OR char_length(pitch) <= 120),
  claim_number  bigint UNIQUE,
  price_paid    integer,
  clicks        integer NOT NULL DEFAULT 0,
  sold_at       timestamptz,
  ls_order_id   text,
  wall_entry_id bigint REFERENCES wall_entries(id),
  -- Legacy slug column. New sales put the slug on wall_entries; this is only still
  -- populated for rows that predate the Wall.
  slug          text,
  -- FROZEN HISTORICAL DATA. The encore feature (free airtime for a past buyer in an
  -- unsold hour) is gone, but these clicks were real. Never read, never written.
  encore_clicks integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slots_starts_at_idx ON slots (starts_at);
CREATE INDEX IF NOT EXISTS slots_status_starts_at_idx ON slots (status, starts_at);
CREATE INDEX IF NOT EXISTS slots_sold_at_idx ON slots (sold_at) WHERE sold_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS slots_claim_number_idx
  ON slots (claim_number) WHERE claim_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS slots_slug_idx ON slots (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS slots_wall_entry_idx ON slots (wall_entry_id);
CREATE INDEX IF NOT EXISTS slots_ls_order_idx ON slots (ls_order_id);

CREATE SEQUENCE IF NOT EXISTS claim_number_seq START WITH 1;
SELECT setval(
  'claim_number_seq',
  COALESCE((SELECT max(claim_number) FROM slots), 1),
  EXISTS (SELECT 1 FROM slots WHERE claim_number IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- Checkout holds the hour it assigned, so the hour quoted before payment is the hour
-- delivered after it. It holds no price: the price is derived from the Wall and only
-- ever rises, so there is nothing to freeze.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id         bigint REFERENCES slots(id) ON DELETE CASCADE,
  amount          integer,
  expires_at      timestamptz NOT NULL,
  ls_checkout_url text,
  display_name    text,
  url             text,
  pitch           text,
  status          text NOT NULL DEFAULT 'pending',  -- pending | completed | expired
  -- Set when the payment lands. This is how /success finds the sale it just paid for
  -- without guessing at a slug that is assigned inside the sale transaction.
  wall_entry_id   bigint REFERENCES wall_entries(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservations_pending_slot_idx
  ON reservations (slot_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS reservations_expiry_idx
  ON reservations (expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Clicks. Dedupe is enforced by the primary key, never by app logic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  slot_id    bigint NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, ip_hash)
);

CREATE TABLE IF NOT EXISTS wall_clicks (
  entry_id   bigint NOT NULL REFERENCES wall_entries(id) ON DELETE CASCADE,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, ip_hash)
);

-- ---------------------------------------------------------------------------
-- Anonymous, browser-backed unique visitors. Server renders and bots without
-- JavaScript do not create rows, so the header cannot be inflated by page requests.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
  id             uuid PRIMARY KEY,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors (last_seen_at);

-- One row per visitor per hour they were active. The primary key does the deduping.
CREATE TABLE IF NOT EXISTS visit_hours (
  visitor_id uuid NOT NULL,
  hour       timestamptz NOT NULL,
  PRIMARY KEY (visitor_id, hour)
);

CREATE INDEX IF NOT EXISTS visit_hours_hour_idx ON visit_hours (hour);

-- FROZEN HISTORICAL DATA. Generic key/value counters, written by features that no
-- longer exist (the X post spend cap) plus an archived visits_total. Nothing reads
-- this table; it is kept so those numbers are not thrown away.
CREATE TABLE IF NOT EXISTS counters (
  key   text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0
);

-- ===========================================================================
-- 2026-08-23 simplification.
--
-- Migrates a database created by the previous schema. The CREATE TABLE blocks above
-- already describe the target shape, so on a fresh database every statement here is a
-- no-op.
--
-- Deleted: the stored board price and everything that moved it (20% sale bump, -10%
-- decay, silent-hour counter, all-time-high ratchet, prime/quiet multipliers, $1
-- clearance), outbound email, the X API, gifting, standing hours, multi-hour blocks,
-- the encore, and the separate Wall-only product.
-- ===========================================================================

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS wall_entry_id bigint REFERENCES wall_entries(id);
ALTER TABLE reservations ALTER COLUMN slot_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS amount integer;
-- Dynamic, because a plain UPDATE naming locked_price fails to PARSE once the column
-- is gone -- the guard would never get the chance to run.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'reservations' AND column_name = 'locked_price') THEN
    EXECUTE 'UPDATE reservations SET amount = locked_price WHERE amount IS NULL';
  END IF;
END $$;

-- A purchase is one hour again, so the block fan-out table has nothing to hold.
DROP TABLE IF EXISTS reservation_slots;

ALTER TABLE reservations DROP COLUMN IF EXISTS locked_price;
ALTER TABLE reservations DROP COLUMN IF EXISTS block_hours;
ALTER TABLE reservations DROP COLUMN IF EXISTS standing_days;
ALTER TABLE reservations DROP COLUMN IF EXISTS kind;
ALTER TABLE reservations DROP COLUMN IF EXISTS gifter_handle;
ALTER TABLE reservations DROP COLUMN IF EXISTS x_handle;
-- Lemon Squeezy is Merchant of Record and holds the buyer's email. We no longer send
-- anything, so keeping a copy is personal data with no purpose behind it.
ALTER TABLE reservations DROP COLUMN IF EXISTS buyer_email;

ALTER TABLE slots DROP COLUMN IF EXISTS buyer_email;
ALTER TABLE slots DROP COLUMN IF EXISTS x_handle;
ALTER TABLE slots DROP COLUMN IF EXISTS gifter_handle;
ALTER TABLE slots DROP COLUMN IF EXISTS standing_through;
ALTER TABLE slots DROP COLUMN IF EXISTS announced;
ALTER TABLE slots DROP COLUMN IF EXISTS reminded;
ALTER TABLE slots DROP COLUMN IF EXISTS completed;
DROP INDEX IF EXISTS slots_post_number_idx;
ALTER TABLE slots DROP COLUMN IF EXISTS post_number;

ALTER TABLE wall_entries DROP COLUMN IF EXISTS buyer_email;
ALTER TABLE wall_entries DROP COLUMN IF EXISTS x_handle;
ALTER TABLE wall_entries DROP COLUMN IF EXISTS gifter_handle;
ALTER TABLE wall_entries DROP COLUMN IF EXISTS standing_days;
-- Every purchase now buys a Wall rank AND an hour, so there is only one kind.
ALTER TABLE wall_entries DROP COLUMN IF EXISTS kind;
DROP TYPE IF EXISTS wall_kind;

-- The floor, the ratchet and the decay clock all lived here.
DROP TABLE IF EXISTS board;

-- NOTE: the one-time backfill that created a wall_entries row for every sold slot has
-- been REMOVED from this file on purpose. It has already run, and leaving it in would
-- resurrect entries deleted by scripts/cleanup-wall.ts on the next migrate.
