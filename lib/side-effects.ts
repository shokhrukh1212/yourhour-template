import { query } from "./db";
import { sendHourComplete, sendReminder } from "./email";
import { getBoard, getNextOpenSlot } from "./slots";
import { hourPrice } from "./pricing";
import { HOUR_MS } from "./time";
import { buildAnnouncement, postAnnouncement } from "./x";
import { trackServerEvent } from "./analytics";

export type SideEffectResult = {
  announced: string | null;
  announceSkipped: string | null;
  remindersSent: number;
  completionsSent: number;
};

/**
 * Outbound work that must NOT run on page reads: the X post and the reminder emails.
 * Called only by the cron tick. Every step claims its row first, so two ticks racing
 * can never double-post or double-email.
 */
export async function runDueSideEffects(): Promise<SideEffectResult> {
  const announce = await announceCurrentHour();
  const remindersSent = await sendDueReminders();
  const completionsSent = await sendDueCompletions();
  return { ...announce, remindersSent, completionsSent };
}

export async function announceCurrentHour(): Promise<{
  announced: string | null;
  announceSkipped: string | null;
}> {
  // Only ever the hour that is on screen right now. A missed hour is never announced
  // late, which is also what keeps a backlog from forming after downtime.
  //
  // post_number is taken here rather than at payment time: it is the Nth hour to go
  // live, not the Nth purchase, and those two orders diverge as soon as somebody books
  // a later hour before somebody else books an earlier one.
  //
  // `announced = false` is repeated in the OUTER where on purpose. Under READ COMMITTED
  // two concurrent ticks can both resolve the subquery to the same id; without it the
  // second re-checks only `id = X`, which still matches, and the hour posts twice.
  const claimed = await query<{
    id: string;
    display_name: string | null;
    pitch: string | null;
    x_handle: string | null;
    post_number: number | null;
    price_paid: number | null;
    gifter_handle: string | null;
    wall_entry_id: string | null;
    standing_through: Date | null;
    starts_at: Date;
  }>(
    `UPDATE slots SET announced = true,
            post_number = COALESCE((SELECT max(post_number) FROM slots), 0) + 1
      WHERE announced = false
        AND id = (
        SELECT id FROM slots
         WHERE starts_at = date_trunc('hour', now())
           AND status = 'sold'
           AND announced = false
         LIMIT 1
      )
      RETURNING id::text AS id, display_name, pitch, x_handle, post_number, price_paid,
                gifter_handle, wall_entry_id::text AS wall_entry_id, standing_through,
                starts_at`,
  );

  const slot = claimed[0];
  if (!slot) return { announced: null, announceSkipped: null };

  // A block of consecutive hours is ONE sale, so it gets ONE post covering the whole
  // run -- not the same product three times in three hours. The later hours are claimed
  // here so the cron does not announce them again when they come round.
  //
  // A standing hour is deliberately NOT grouped: its days are 24 hours apart, so each
  // one is a separate live moment and earns its own post.
  const run = await claimRun("announced", slot, 1);
  const blockHours = 1 + run.length;
  // What this post actually covers. For a single hour that is the hour's own share; for
  // a block it adds back up to the full amount, which is also what ranks them on the Wall.
  const pricePaid = [slot, ...run].reduce((sum, r) => sum + (r.price_paid ?? 0), 0) || null;

  // Read the board after the sale has been applied, so "the next hour costs" is the
  // price the reader will actually be quoted. Under peak pricing the stored floor is a
  // base and not a price anybody is offered, so quote the next open hour itself --
  // tier and last-minute clearance included. Falling back to the floor only matters
  // when the whole calendar is sold out, and then no price is being offered at all.
  const [board, nextOpen] = await Promise.all([getBoard(), getNextOpenSlot()]);
  const nextPrice = nextOpen
    ? hourPrice(board.price, new Date(nextOpen.starts_at))
    : board.price;

  const text = buildAnnouncement({
    displayName: slot.display_name ?? "a new product",
    pitch: slot.pitch,
    slotId: slot.id,
    postNumber: slot.post_number ?? Number(slot.id),
    xHandle: slot.x_handle,
    gifterHandle: slot.gifter_handle,
    pricePaid,
    blockHours,
    nextPrice,
  });

  const result = await postAnnouncement(text);

  if (result.ok) {
    void trackServerEvent("hour_announced", { slotId: slot.id });
    return { announced: slot.id, announceSkipped: null };
  }

  // Nothing was published, so the number must go back -- a consumed number that never
  // appeared would leave a permanent hole in the public sequence.
  // Every hour this post would have covered has to be released, not just the first.
  const covered = [slot.id, ...run.map((r) => r.id)];
  if (result.reason === "error") {
    // Transient failure: release the claim too, so the next tick retries this hour.
    await query(
      `UPDATE slots SET announced = false, post_number = NULL
        WHERE id = ANY($1::bigint[])`,
      [covered],
    );
    console.error(`X announcement failed for slot ${slot.id}: ${result.detail}`);
  } else {
    // Deliberately skipped (kill switch, or the daily spend cap). The hours are not
    // retried, but nothing aired, so no number is kept.
    await query(`UPDATE slots SET post_number = NULL WHERE id = ANY($1::bigint[])`, [
      covered,
    ]);
    console.warn(`X announcement skipped for slot ${slot.id}: ${result.reason}`);
  }

  return { announced: null, announceSkipped: result.reason };
}

type RunSlot = { id: string; price_paid: number | null; clicks: number };

type RunAnchor = {
  id: string;
  wall_entry_id: string | null;
  standing_through: Date | null;
  starts_at: Date;
};

/**
 * The rest of an unbroken hourly run belonging to the same purchase, claimed under the
 * given flag so the cron cannot act on those hours separately. A block of consecutive
 * hours is ONE sale, so it earns one post, one reminder and one summary -- not three.
 *
 * `direction` is +1 to walk forward from the hour that is starting (announcements and
 * reminders, which fire on the FIRST hour) and -1 to walk back from the hour that just
 * ended (the summary, which fires on the LAST).
 *
 * Walks one hour at a time and stops at the first gap, so a buyer who owns 3pm and 5pm
 * but not 4pm is treated as two separate appearances -- which is what they are. Standing
 * runs are excluded via standing_through: their hours are days apart, so each one is
 * genuinely its own moment.
 */
async function claimRun(
  flag: "announced" | "reminded" | "completed",
  slot: RunAnchor,
  direction: 1 | -1,
): Promise<RunSlot[]> {
  if (!slot.wall_entry_id || slot.standing_through) return [];

  // `flag` is one of three literals fixed at the call sites, never user input.
  const siblings = await query<{
    id: string;
    starts_at: Date;
    price_paid: number | null;
    clicks: number;
  }>(
    `SELECT id::text AS id, starts_at, price_paid, clicks FROM slots
      WHERE wall_entry_id = $1
        AND standing_through IS NULL
        AND ${flag} = false
        AND starts_at ${direction === 1 ? ">" : "<"} $2
      ORDER BY starts_at ${direction === 1 ? "ASC" : "DESC"}`,
    [slot.wall_entry_id, slot.starts_at],
  );

  const run: RunSlot[] = [];
  let expected = new Date(slot.starts_at).getTime() + direction * HOUR_MS;
  for (const sibling of siblings) {
    if (new Date(sibling.starts_at).getTime() !== expected) break;
    run.push({ id: sibling.id, price_paid: sibling.price_paid, clicks: sibling.clicks });
    expected += direction * HOUR_MS;
  }
  if (run.length === 0) return [];

  // Claimed the same way the anchor hour was, so a racing tick cannot double-act.
  const claimed = await query<{ id: string }>(
    `UPDATE slots SET ${flag} = true
      WHERE id = ANY($1::bigint[]) AND ${flag} = false
      RETURNING id::text AS id`,
    [run.map((r) => r.id)],
  );
  const won = new Set(claimed.map((r) => r.id));
  return run.filter((r) => won.has(r.id));
}

async function sendDueReminders(): Promise<number> {
  // Hours begin on the hour, so a tick at :00 sees the next one 60 minutes out and a
  // tick at :00 the following hour sees it already started -- a narrow window around 30
  // minutes is unreachable from an on-the-hour schedule. The driver therefore ticks at
  // :00 AND :30, and this band is widened to 20-40 minutes so ten minutes of drift on
  // either side of the :30 tick still lands. `reminded` is what prevents a second send,
  // not the window, so widening it cannot duplicate anything.
  const claimed = await query<{
    id: string;
    buyer_email: string | null;
    display_name: string | null;
    starts_at: Date;
    slug: string | null;
    wall_entry_id: string | null;
    standing_through: Date | null;
  }>(
    `UPDATE slots s SET reminded = true
      WHERE s.id IN (
        SELECT id FROM slots
         WHERE status = 'sold'
           AND reminded = false
           AND buyer_email IS NOT NULL
           AND starts_at BETWEEN now() + interval '20 minutes'
                             AND now() + interval '40 minutes'
      )
      RETURNING s.id::text AS id, s.buyer_email, s.display_name, s.starts_at,
                COALESCE((SELECT slug FROM wall_entries WHERE id = s.wall_entry_id), s.slug)
                  AS slug,
                s.wall_entry_id::text AS wall_entry_id, s.standing_through`,
  );

  let sent = 0;
  for (const slot of claimed) {
    if (!slot.buyer_email) continue;
    // One reminder for the whole run: a second one 30 minutes before the block's own
    // second hour would land while the buyer is already live.
    const run = await claimRun("reminded", slot, 1);
    const ok = await sendReminder({
      to: slot.buyer_email,
      displayName: slot.display_name ?? "Your product",
      startsAt: new Date(slot.starts_at),
      slug: slot.slug ?? "",
      blockHours: 1 + run.length,
    });
    if (ok) sent++;
    else {
      await query(
        `UPDATE slots SET reminded = false WHERE id = ANY($1::bigint[])`,
        [[slot.id, ...run.map((r) => r.id)]],
      );
    }
  }
  return sent;
}

/**
 * "Your hour is done" -- sent at the top of the hour their hour ended, because the cron
 * fires on the hour and reconcileBoard() has already marked the slot past by then.
 *
 * The two-hour lookback absorbs a missed tick without ever mailing last week's buyers.
 * The row is claimed before the send, exactly like the reminder, so two ticks racing
 * cannot double-send; a failed send releases the claim for the next tick.
 */
async function sendDueCompletions(): Promise<number> {
  const claimed = await query<{
    id: string;
    buyer_email: string | null;
    display_name: string | null;
    starts_at: Date;
    slug: string | null;
    price_paid: number | null;
    clicks: number;
    wall_entry_id: string | null;
    standing_through: Date | null;
  }>(
    // The slug lives on the Wall entry for anything sold since the Wall shipped; the
    // slots column is only still populated for rows that predate it. Reading just
    // slots.slug here silently skipped every block sale, because applyHourBlock never
    // writes it there.
    `UPDATE slots s SET completed = true
      WHERE s.id IN (
        SELECT id FROM slots o
         WHERE o.status = 'past'
           AND o.completed = false
           AND o.buyer_email IS NOT NULL
           AND o.starts_at + interval '1 hour' BETWEEN now() - interval '2 hours' AND now()
           -- Only the LAST hour of a consecutive run reports. The earlier hours are
           -- summed into its email and closed with it, so one block is one summary.
           AND NOT EXISTS (
             SELECT 1 FROM slots nxt
              WHERE o.wall_entry_id IS NOT NULL
                AND nxt.wall_entry_id = o.wall_entry_id
                AND o.standing_through IS NULL
                AND nxt.standing_through IS NULL
                AND nxt.starts_at = o.starts_at + interval '1 hour'
           )
      )
      RETURNING s.id::text AS id, s.buyer_email, s.display_name, s.starts_at,
                COALESCE((SELECT slug FROM wall_entries WHERE id = s.wall_entry_id), s.slug)
                  AS slug,
                s.price_paid, s.clicks,
                s.wall_entry_id::text AS wall_entry_id, s.standing_through`,
  );

  if (claimed.length === 0) return 0;

  // One read for the whole batch: "an hour now costs" is a board-wide number.
  const board = await getBoard();

  let sent = 0;
  for (const slot of claimed) {
    if (!slot.buyer_email || !slot.slug) continue;

    // Walk BACK over the run this hour ended, so the summary reports the whole block:
    // its total clicks, everything paid for it, and the hour it actually began.
    const run = await claimRun("completed", slot, -1);
    const blockHours = 1 + run.length;
    const clicks = slot.clicks + run.reduce((n, r) => n + r.clicks, 0);
    const pricePaid =
      [slot, ...run].reduce((n, r) => n + (r.price_paid ?? 0), 0) || null;
    const startsAt = new Date(
      new Date(slot.starts_at).getTime() - run.length * HOUR_MS,
    );

    const ok = await sendHourComplete({
      to: slot.buyer_email,
      displayName: slot.display_name ?? "Your product",
      startsAt,
      slug: slot.slug,
      clicks,
      pricePaid,
      boardPrice: board.price,
      blockHours,
    });
    if (ok) sent++;
    else {
      await query(
        `UPDATE slots SET completed = false WHERE id = ANY($1::bigint[])`,
        [[slot.id, ...run.map((r) => r.id)]],
      );
    }
  }
  return sent;
}
