import { getPool, query } from "../lib/db";

async function main() {
  const columns = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campaigns'`,
  );
  const names = new Set(columns.map((column) => column.column_name));
  if (!names.has("total_clicks_delivered")) {
    const rows = await query<{ campaigns: string; delivered: string; bonus: string; active: string }>(
      `SELECT count(*)::text AS campaigns,
              COALESCE(sum(clicks_delivered), 0)::text AS delivered,
              COALESCE(sum(bonus_clicks), 0)::text AS bonus,
              count(*) FILTER (WHERE status IN ('live','queued'))::text AS active
         FROM campaigns`,
    );
    console.log("canonical schema: pending migration");
    console.table(rows);
    return;
  }

  const [summary, screenwar, legacy, orders, audit] = await Promise.all([
    query(`SELECT count(*)::int AS campaigns,
                  COALESCE(sum(total_clicks_delivered), 0)::int AS delivered,
                  COALESCE(sum(bonus_clicks_delivered), 0)::int AS bonus,
                  count(*) FILTER (WHERE status IN ('live','queued'))::int AS active
             FROM campaigns`),
    query(`SELECT purchased_clicks, guaranteed_clicks_delivered,
                  bonus_clicks_delivered, total_clicks_delivered
             FROM campaigns WHERE slug = 'screenwar'`),
    query(`SELECT id::text, slug, product_name, total_clicks_delivered
             FROM campaigns WHERE accounting_status = 'legacy_total_only'
             ORDER BY id`),
    query(`SELECT count(*)::int AS completed_orders,
                  count(DISTINCT ls_order_id)::int AS distinct_order_ids
             FROM checkout_intents WHERE status = 'completed' AND ls_order_id IS NOT NULL`),
    query(`SELECT reason_code, provenance, corrected_at
             FROM campaign_accounting_audits WHERE reason_code = 'screenwar-confirmed-2026-08-24'`),
  ]);
  console.log("canonical schema: applied");
  console.table(summary);
  console.log("Screenwar");
  console.table(screenwar);
  console.log("preserved legacy-total-only campaigns");
  console.table(legacy);
  console.log("provider order idempotency");
  console.table(orders);
  console.log("accounting audit");
  console.table(audit);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
