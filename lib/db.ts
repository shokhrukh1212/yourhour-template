import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { Pool, type PoolClient } from "pg";

// WSL and some container networks advertise IPv6 without a usable route, which makes
// Node's Happy Eyeballs stall on the AAAA record before falling back. Postgres is
// reached over IPv4 everywhere we deploy, so pin the lookup order and disable the race.
setDefaultResultOrder("ipv4first");
setDefaultAutoSelectFamily(false);

declare global {
  // Reused across hot reloads in dev and across warm Fluid Compute invocations.
  var __yourhourPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Run `vercel env pull`.");
  }
  return new Pool({
    // pg currently aliases sslmode=require to verify-full but will adopt weaker libpq
    // semantics in v9. Pin the strong mode now so the upgrade can't silently downgrade TLS.
    connectionString: connectionString.replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full"),
    // Neon's pooler fronts this, so keep the per-instance pool small.
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
  });
}

export function getPool(): Pool {
  if (!globalThis.__yourhourPool) globalThis.__yourhourPool = createPool();
  return globalThis.__yourhourPool;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/** Run fn inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Board-wide serialization lock. Transaction-scoped (not session-scoped) so it
 * survives PgBouncer transaction pooling, which is how Neon's pooled URL works.
 */
export const BOARD_LOCK_KEY = 8_140_25_01;

export async function lockBoard(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [BOARD_LOCK_KEY]);
}
