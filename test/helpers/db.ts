import { Client } from "pg";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted_test";

/**
 * The schema is migrated once per run by test/global-setup.ts, which avoids
 * several forked test files racing to drop and recreate it. This remains as the
 * documented entry point for test files that need the schema.
 */
export async function ensureTestSchema(): Promise<void> {
  // Intentionally empty: global setup has already run by the time a test file
  // executes. Kept so test files state their dependency explicitly.
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  return client;
}

/** Set the RLS context on a raw client, mirroring what withAccount does. */
export async function setContext(
  client: Client,
  ctx: { accountId?: string | null; userId?: string | null; isAdmin?: boolean },
): Promise<void> {
  await client.query("select set_config('app.current_account_id', $1, false)", [ctx.accountId ?? ""]);
  await client.query("select set_config('app.current_user_id', $1, false)", [ctx.userId ?? ""]);
  await client.query("select set_config('app.is_admin', $1, false)", [String(ctx.isAdmin ?? false)]);
}

export async function clearContext(client: Client): Promise<void> {
  await setContext(client, { accountId: null, userId: null, isAdmin: false });
}

export type Fixture = {
  accountId: string;
  userId: string;
  propertyId: string;
  entityId: string;
};

let counter = 0;

/**
 * Create an account, its owner user, one landlord entity and one property.
 *
 * Signup goes through app_signup (as the real app does); the rest is inserted
 * under that account's own RLS context, which also proves the insert policies
 * work for the happy path.
 */
export async function createAccount(
  client: Client,
  name: string,
  type: "landlord" | "agent" = "landlord",
): Promise<Fixture> {
  await clearContext(client);
  const email = `${name.replace(/\W/g, "").toLowerCase()}-${++counter}-${process.pid}@example.test`;
  const signup = await client.query<{ account_id: string; user_id: string }>(
    "select account_id, user_id from app_signup($1, $2, $3, $4::account_type)",
    [email, name, name, type],
  );
  const { account_id: accountId, user_id: userId } = signup.rows[0]!;

  await setContext(client, { accountId, userId });

  const entity = await client.query<{ id: string }>(
    "insert into landlord_entities (account_id, name) values ($1, $2) returning id",
    [accountId, name],
  );
  const property = await client.query<{ id: string }>(
    `insert into properties (account_id, line1, postcode, itl1_region)
     values ($1, $2, $3, 'west_midlands') returning id`,
    [accountId, `1 ${name} Road`, "B1 1AA"],
  );

  return { accountId, userId, propertyId: property.rows[0]!.id, entityId: entity.rows[0]!.id };
}

export async function grantAgent(
  client: Client,
  landlord: Fixture,
  agent: Fixture,
): Promise<string> {
  // Only the landlord may create a grant, so set their context to do it.
  await setContext(client, { accountId: landlord.accountId, userId: landlord.userId });
  const { rows } = await client.query<{ id: string }>(
    "insert into agent_grants (agent_account_id, landlord_account_id) values ($1, $2) returning id",
    [agent.accountId, landlord.accountId],
  );
  return rows[0]!.id;
}

export async function revokeAgent(client: Client, landlord: Fixture, grantId: string): Promise<void> {
  await setContext(client, { accountId: landlord.accountId, userId: landlord.userId });
  await client.query("update agent_grants set revoked_at = now() where id = $1", [grantId]);
}

/**
 * A connection that bypasses RLS, used only to simulate an attacker with direct
 * database access.
 *
 * The Evidence Ledger's hash chain exists precisely for the case where someone
 * gets past the application and the RLS policies. Proving the chain detects
 * tampering therefore requires reaching the rows the way such an attacker would.
 * Nothing in the application ever uses this role.
 */
export const BYPASS_DATABASE_URL =
  process.env.BYPASS_DATABASE_URL ??
  TEST_DATABASE_URL.replace("letsorted:letsorted@", "letsorted_bypass:bypass@");

export async function connectBypassingRls(): Promise<Client> {
  const client = new Client({ connectionString: BYPASS_DATABASE_URL });
  await client.connect();
  return client;
}
