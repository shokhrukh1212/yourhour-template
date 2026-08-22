-- yourhour.lol schema
-- All timestamps UTC. All money in integer cents.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE slot_status AS ENUM ('open','reserved','sold','past');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS slots (
  id            bigserial PRIMARY KEY,
  starts_at     timestamptz NOT NULL UNIQUE,      -- always exactly on the hour, UTC
  status        slot_status NOT NULL DEFAULT 'open',
  buyer_email   text,
  display_name  text,
  url           text,
  pitch         text CHECK (pitch IS NULL OR char_length(pitch) <= 120),
  x_handle      text CHECK (x_handle IS NULL OR x_handle ~ '^@[A-Za-z0-9_]{1,15}$'),
  claim_number  bigint UNIQUE,
  price_paid    integer,
  clicks        integer NOT NULL DEFAULT 0,
  announced     boolean NOT NULL DEFAULT false,
  reminded      boolean NOT NULL DEFAULT false,
  sold_at       timestamptz,
  ls_order_id   text UNIQUE,                      -- webhook idempotency key
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slots_starts_at_idx ON slots (starts_at);
CREATE INDEX IF NOT EXISTS slots_status_starts_at_idx ON slots (status, starts_at);
CREATE INDEX IF NOT EXISTS slots_sold_at_idx ON slots (sold_at) WHERE sold_at IS NOT NULL;

ALTER TABLE slots ADD COLUMN IF NOT EXISTS x_handle text
  CHECK (x_handle IS NULL OR x_handle ~ '^@[A-Za-z0-9_]{1,15}$');
ALTER TABLE slots ADD COLUMN IF NOT EXISTS claim_number bigint;
CREATE UNIQUE INDEX IF NOT EXISTS slots_claim_number_idx
  ON slots (claim_number) WHERE claim_number IS NOT NULL;
CREATE SEQUENCE IF NOT EXISTS claim_number_seq START WITH 1;
SELECT setval(
  'claim_number_seq',
  COALESCE((SELECT max(claim_number) FROM slots), 1),
  EXISTS (SELECT 1 FROM slots WHERE claim_number IS NOT NULL)
);
UPDATE slots
   SET claim_number = nextval('claim_number_seq')
 WHERE claim_number IS NULL AND sold_at IS NOT NULL;

-- Single-row table holding the one board price P.
CREATE TABLE IF NOT EXISTS board (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  price         integer NOT NULL,
  last_sale_at  timestamptz,
  last_decay_at timestamptz NOT NULL
);

-- One row per counted click. Dedupe is enforced by the primary key, not app logic.
-- A slot IS an hour, so (slot_id, ip_hash) already scopes dedupe to the hour.
CREATE TABLE IF NOT EXISTS clicks (
  slot_id    bigint NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slot_id, ip_hash)
);

-- Holds the slot AND freezes the price for the checkout window.
CREATE TABLE IF NOT EXISTS reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id         bigint NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  locked_price    integer NOT NULL,
  expires_at      timestamptz NOT NULL,
  ls_checkout_url text,
  buyer_email     text,
  display_name    text,
  url             text,
  pitch           text,
  x_handle        text CHECK (x_handle IS NULL OR x_handle ~ '^@[A-Za-z0-9_]{1,15}$'),
  status          text NOT NULL DEFAULT 'pending',  -- pending | completed | expired
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservations_pending_slot_idx
  ON reservations (slot_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS reservations_expiry_idx
  ON reservations (expires_at) WHERE status = 'pending';

ALTER TABLE reservations ADD COLUMN IF NOT EXISTS x_handle text
  CHECK (x_handle IS NULL OR x_handle ~ '^@[A-Za-z0-9_]{1,15}$');

-- Anonymous, browser-backed unique visitors. Server renders and bots without JavaScript
-- do not create rows, so the header cannot be inflated by page requests.
CREATE TABLE IF NOT EXISTS visitors (
  id             uuid PRIMARY KEY,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- Generic counters, currently used for the X spend cap: 'x_posts:YYYY-MM-DD'.
CREATE TABLE IF NOT EXISTS counters (
  key   text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0
);

-- Free "encore" airtime given to a past buyer when nobody claims the live hour.
-- Kept separate from clicks so an archive row always means "clicks during that hour".
ALTER TABLE slots ADD COLUMN IF NOT EXISTS encore_clicks integer NOT NULL DEFAULT 0;

-- Lets the honesty block quote a real traffic number instead of a guess.
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS visitors_last_seen_idx ON visitors (last_seen_at);

-- One row per visitor per hour they were active. The primary key does the deduping,
-- exactly like the clicks table. visitors alone holds a single timestamp per browser,
-- which cannot answer "how many were here in each of the last 168 hours".
CREATE TABLE IF NOT EXISTS visit_hours (
  visitor_id uuid NOT NULL,
  hour       timestamptz NOT NULL,
  PRIMARY KEY (visitor_id, hour)
);

CREATE INDEX IF NOT EXISTS visit_hours_hour_idx ON visit_hours (hour);

-- The permanent public identity of a sold hour, e.g. /u/uiwize. Assigned once at sale
-- time and never recomputed: posted links and cached cards depend on it never moving.
ALTER TABLE slots ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS slots_slug_idx ON slots (slug) WHERE slug IS NOT NULL;

-- The "your hour is done" email, claimed the same way `announced` and `reminded` are.
ALTER TABLE slots ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;

-- Hours that ended before this column existed must not be emailed retroactively. The
-- last two hours are left alone, since that is exactly the window a send is still due in.
UPDATE slots SET completed = true
 WHERE status = 'past' AND completed = false
   AND starts_at < date_trunc('hour', now()) - interval '2 hours';

-- ---------------------------------------------------------------------------
-- THE WALL, flexible pricing, and the ratcheted floor.
-- ---------------------------------------------------------------------------

-- The highest P has ever been. The floor is half of this, forever, so a long quiet
-- stretch can give back some of a climb but never all of it.
ALTER TABLE board ADD COLUMN IF NOT EXISTS all_time_high_floor integer NOT NULL DEFAULT 0;
-- Consecutive fully-elapsed clock hours with zero hour sales. Any sale resets it to 0.
ALTER TABLE board ADD COLUMN IF NOT EXISTS silent_hours integer NOT NULL DEFAULT 0;
UPDATE board SET all_time_high_floor = GREATEST(all_time_high_floor, price) WHERE id = 1;

DO $$ BEGIN
  CREATE TYPE wall_kind AS ENUM ('hour','wall');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per PURCHASE, not per hour: a single hour, a multi-hour block, or a
-- Wall-only spot that consumes no hour at all. This owns the permanent public
-- identity (the slug) and the amount that ranks the buyer on the Wall.
CREATE TABLE IF NOT EXISTS wall_entries (
  id           bigserial PRIMARY KEY,
  kind         wall_kind NOT NULL,
  amount_paid  integer NOT NULL,
  display_name text,
  url          text,
  pitch        text CHECK (pitch IS NULL OR char_length(pitch) <= 120),
  x_handle     text CHECK (x_handle IS NULL OR x_handle ~ '^@[A-Za-z0-9_]{1,15}$'),
  buyer_email  text,
  slug         text,
  -- kind='wall' only. An 'hour' entry's clicks roll up from its slots, so that an
  -- hour row never stops meaning "clicks earned during that hour".
  clicks       integer NOT NULL DEFAULT 0,
  ls_order_id  text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wall_entries_slug_idx
  ON wall_entries (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS wall_entries_rank_idx
  ON wall_entries (amount_paid DESC, created_at ASC);

ALTER TABLE slots ADD COLUMN IF NOT EXISTS wall_entry_id bigint REFERENCES wall_entries(id);
CREATE INDEX IF NOT EXISTS slots_wall_entry_idx ON slots (wall_entry_id);

-- A block is ONE order spread across N slots, so this can no longer be unique.
-- Webhook idempotency moved to wall_entries.ls_order_id, which is one row per order.
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_ls_order_id_key;
CREATE INDEX IF NOT EXISTS slots_ls_order_idx ON slots (ls_order_id);

-- Wall-only entries have no slot, so they need their own counted redirect. Same
-- shape as `clicks`: the primary key does the deduping, not app logic.
CREATE TABLE IF NOT EXISTS wall_clicks (
  entry_id   bigint NOT NULL REFERENCES wall_entries(id) ON DELETE CASCADE,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, ip_hash)
);

-- A reservation now holds a block of hours, or no hour at all.
ALTER TABLE reservations ALTER COLUMN slot_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'hour';
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS block_hours integer NOT NULL DEFAULT 1;
-- locked_price is the MINIMUM this checkout may pay; amount is what the buyer chose.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS amount integer;
UPDATE reservations SET amount = locked_price WHERE amount IS NULL;

-- reservations.slot_id stays as the block's first hour; this is the full list.
CREATE TABLE IF NOT EXISTS reservation_slots (
  reservation_id uuid   NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  slot_id        bigint NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  PRIMARY KEY (reservation_id, slot_id)
);
CREATE INDEX IF NOT EXISTS reservation_slots_slot_idx ON reservation_slots (slot_id);

INSERT INTO reservation_slots (reservation_id, slot_id)
SELECT id, slot_id FROM reservations WHERE slot_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Every hour ever sold becomes a Wall entry, carrying its slug across so that every
-- link already posted to /u/{slug} keeps resolving. source_slot_id exists only so this
-- backfill can link the two sides unambiguously -- a legacy row may have no slug and no
-- order id, and matching on either alone would strand it.
ALTER TABLE wall_entries ADD COLUMN IF NOT EXISTS source_slot_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS wall_entries_source_slot_idx
  ON wall_entries (source_slot_id) WHERE source_slot_id IS NOT NULL;

INSERT INTO wall_entries (kind, amount_paid, display_name, url, pitch, x_handle,
                          buyer_email, slug, ls_order_id, created_at, source_slot_id)
SELECT 'hour', COALESCE(price_paid, 0), display_name, url, pitch, x_handle,
       buyer_email, slug, ls_order_id, COALESCE(sold_at, created_at), id
  FROM slots
 WHERE sold_at IS NOT NULL AND wall_entry_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE slots s SET wall_entry_id = e.id
  FROM wall_entries e
 WHERE e.source_slot_id = s.id AND s.wall_entry_id IS NULL;

-- ---------------------------------------------------------------------------
-- Peak pricing, standing hours, last-minute clearance, and gifting.
--
-- Peak pricing and clearance are display/checkout concerns only: they scale the ONE
-- stored board price at the moment an hour is quoted, so nothing here records a tier.
-- ---------------------------------------------------------------------------

-- Gifting. The RECIPIENT's handle goes in the existing x_handle column, so every
-- surface that already mentions the buyer mentions the recipient instead. This column
-- holds who actually paid for it.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS gifter_handle text
  CHECK (gifter_handle IS NULL OR gifter_handle ~ '^@[A-Za-z0-9_]{1,15}$');
ALTER TABLE wall_entries ADD COLUMN IF NOT EXISTS gifter_handle text
  CHECK (gifter_handle IS NULL OR gifter_handle ~ '^@[A-Za-z0-9_]{1,15}$');
ALTER TABLE slots ADD COLUMN IF NOT EXISTS gifter_handle text
  CHECK (gifter_handle IS NULL OR gifter_handle ~ '^@[A-Za-z0-9_]{1,15}$');

-- A standing hour is the same hour of the day on N consecutive days: one payment, one
-- Wall entry, one move of the floor, but its own slot row and announcement each day.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS standing_days integer NOT NULL DEFAULT 0;
ALTER TABLE wall_entries ADD COLUMN IF NOT EXISTS standing_days integer NOT NULL DEFAULT 0;

-- Denormalised onto every slot of a standing purchase so a calendar row can render
-- "held through Aug 29" on its own, with no join. Written once at sale time.
ALTER TABLE slots ADD COLUMN IF NOT EXISTS standing_through timestamptz;

-- The number printed on the X post: the Nth hour to actually GO LIVE, which is not the
-- Nth purchase. claim_number is handed out at payment time, so a buyer who books a later
-- hour first would air ahead of a lower number and the public feed would count backwards.
-- Assigned in announceCurrentHour, at the moment the post goes out.
ALTER TABLE slots ADD COLUMN IF NOT EXISTS post_number integer;
CREATE UNIQUE INDEX IF NOT EXISTS slots_post_number_idx
  ON slots (post_number) WHERE post_number IS NOT NULL;

-- Hours already posted keep the number they were published under, so the sequence
-- continues from the feed rather than restarting.
UPDATE slots SET post_number = claim_number
 WHERE announced = true AND post_number IS NULL AND claim_number IS NOT NULL;
