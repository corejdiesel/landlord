import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * Data access layer.
 *
 * Every query that touches account data runs inside `withAccount`, which opens a
 * transaction and sets the RLS context on that connection. Two consequences we
 * rely on:
 *
 *  1. The context is set with `set_config(..., true)` — transaction-local — so it
 *     cannot leak to the next request that borrows the same pooled connection.
 *  2. Code that forgets to use it gets a connection with no context, and RLS
 *     returns zero rows. Forgetting fails closed, not open.
 *
 * Kept behind this narrow interface so swapping to Supabase later is a change
 * here and nowhere else.
 */

export type AccountContext = {
  accountId: string;
  userId: string;
  isAdmin?: boolean;
};

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted";
    pool = new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => {
      // A pooled connection died in the background. Log it without the DSN.
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Run `fn` in a transaction with the RLS context set for this account. */
export async function withAccount<T>(
  ctx: AccountContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    // `true` = transaction-local, so this cannot outlive the transaction and
    // reach another request through the pool.
    await client.query("select set_config('app.current_account_id', $1, true)", [ctx.accountId]);
    await client.query("select set_config('app.current_user_id', $1, true)", [ctx.userId]);
    await client.query("select set_config('app.is_admin', $1, true)", [String(ctx.isAdmin ?? false)]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` with no account context.
 *
 * For the handful of operations that legitimately precede authentication:
 * looking up a session token, resolving a public passport slug, capturing a
 * radar signup. Everything reachable this way goes through a SECURITY DEFINER
 * function that exposes only the intended fields.
 */
export async function withoutAccount<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Convenience for single-statement reads inside an account context. */
export async function queryAs<T extends QueryResultRow>(
  ctx: AccountContext,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withAccount(ctx, async (client) => {
    const { rows } = await client.query<T>(sql, params);
    return rows;
  });
}

/**
 * Append an event to the account's hash-chained ledger.
 *
 * The chain is computed in the database (see 0002_ledger.sql) so concurrent
 * appends serialise on an advisory lock and cannot fork the chain.
 */
export async function appendLedger(
  client: PoolClient,
  accountId: string,
  eventType: string,
  payload: unknown,
): Promise<{ seq: string; hash: string }> {
  const { rows } = await client.query<{ seq: string; hash: string }>(
    "select seq, hash from ledger_append($1, $2, $3::jsonb)",
    [accountId, eventType, JSON.stringify(payload)],
  );
  const row = rows[0];
  if (!row) throw new Error("ledger_append returned no row");
  return row;
}

export type LedgerProblem = { seq: string; problem: string };

/** Verify an account's chain. An empty array means the chain is intact. */
export async function verifyLedger(
  client: PoolClient,
  accountId: string,
): Promise<LedgerProblem[]> {
  const { rows } = await client.query<LedgerProblem>("select seq, problem from ledger_verify($1)", [
    accountId,
  ]);
  return rows;
}
