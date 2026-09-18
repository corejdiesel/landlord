import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearContext, connect, createAccount, ensureTestSchema, grantAgent, revokeAgent, setContext, type Fixture } from "./helpers/db.js";

/**
 * Row level security suite.
 *
 * These tests run as the ordinary application role against tables with FORCE
 * ROW LEVEL SECURITY, so the table owner gets no exemption. Without FORCE, every
 * assertion here would pass while proving nothing.
 */

let client: Client;
let alice: Fixture;   // landlord
let bob: Fixture;     // unrelated landlord
let agency: Fixture;  // agent with a grant over Alice
let rogue: Fixture;   // agent with no grant at all

beforeAll(async () => {
  await ensureTestSchema();
  client = await connect();
  alice = await createAccount(client, "Alice");
  bob = await createAccount(client, "Bob");
  agency = await createAccount(client, "Agency", "agent");
  rogue = await createAccount(client, "Rogue", "agent");
  await grantAgent(client, alice, agency);
}, 60_000);

afterAll(async () => {
  await client?.end();
});

const ACCOUNT_SCOPED_TABLES = [
  "landlord_entities", "properties", "tenancies", "registrations",
  "register_snapshots", "drift_items", "documents", "obligations",
  "reminders", "pulse_requests", "pulse_responses", "passports", "subscriptions",
];

describe("the security model is actually switched on", () => {
  it("enables AND forces RLS on every account-scoped table", async () => {
    await clearContext(client);
    const { rows } = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relname = any($1) and relkind = 'r'`,
      [[...ACCOUNT_SCOPED_TABLES, "accounts", "users", "sessions", "ledger_events", "agent_grants", "attestation_requests", "radar_signups"]],
    );
    expect(rows.length).toBeGreaterThan(15);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} has RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} has RLS forced (owner not exempt)`).toBe(true);
    }
  });

  it("runs the suite as a non-superuser, since a superuser would bypass RLS", async () => {
    const { rows } = await client.query<{ usesuper: boolean }>(
      "select usesuper from pg_user where usename = current_user",
    );
    expect(rows[0]!.usesuper).toBe(false);
  });
});

/**
 * SECURITY DEFINER does NOT bypass RLS when the table has FORCE ROW LEVEL
 * SECURITY, because FORCE binds the owner too. Every time a pre-context
 * function was written assuming otherwise it silently returned zero rows:
 * sign-in reported a wrong password for a correct one (migration 0008), inbound
 * email routed nowhere (0009), and every tenant passport 404ed while the
 * write-side twin worked fine, which is why it went unnoticed (0012).
 *
 * Zero rows is the worst failure mode available: it looks like "not found"
 * rather than "broken".
 */
const RLS_PROTECTED_TABLES = [
  "accounts", "users", "memberships", "sessions", "properties", "tenancies",
  "documents", "registrations", "passports", "pulse_requests", "pulse_responses",
  "radar_signups", "landlord_entities", "drift_items",
];

/** True when a definer function reads a protected table without raising the flag. */
export function definerLooksUnsafe(functionDefinition: string): boolean {
  const body = functionDefinition.toLowerCase();
  if (!body.includes("security definer")) return false;
  const touches = RLS_PROTECTED_TABLES.some((t) =>
    new RegExp(`(from|join|into|update)\\s+${t}\\b`).test(body));
  if (!touches) return false;
  return !body.includes("app.bootstrap");
};

describe("SECURITY DEFINER functions cannot forget the bootstrap flag", () => {
  it("flags a definer function that reads a protected table without the flag", () => {
    // Proves the detector is not vacuous. This is the exact shape of the bug
    // that shipped three times.
    expect(definerLooksUnsafe(`
      CREATE FUNCTION public_passport(p_slug text) RETURNS SETOF record
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public
        AS $$ select p.id from passports p where p.slug = p_slug $$;
    `)).toBe(true);
  });

  it("accepts the same function once it raises the flag", () => {
    expect(definerLooksUnsafe(`
      CREATE FUNCTION public_passport(p_slug text) RETURNS SETOF record
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO public
        AS $$ begin
          perform set_config('app.bootstrap', 'on', true);
          return query select p.id from passports p where p.slug = p_slug;
          perform set_config('app.bootstrap', 'off', true);
        end $$;
    `)).toBe(false);
  });

  it("ignores a definer function that touches no protected table", () => {
    expect(definerLooksUnsafe(`
      CREATE FUNCTION app_is_bootstrapping() RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER
        AS $$ select coalesce(current_setting('app.bootstrap', true), 'off') = 'on' $$;
    `)).toBe(false);
  });

  it("ignores an ordinary invoker function", () => {
    expect(definerLooksUnsafe(`
      CREATE FUNCTION whatever() RETURNS SETOF record LANGUAGE sql
        AS $$ select id from properties $$;
    `)).toBe(false);
  });

  it("finds no unsafe definer function in the live schema", async () => {
    await clearContext(client);
    const { rows } = await client.query<{ proname: string; src: string }>(
      `select p.proname, pg_get_functiondef(p.oid) as src
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef`,
    );

    expect(rows.length).toBeGreaterThan(5);

    const unsafe = rows.filter((r) => definerLooksUnsafe(r.src)).map((r) => r.proname);
    expect(unsafe, "these definer functions will silently return zero rows").toEqual([]);
  });
});

describe("a connection with no context sees nothing", () => {
  it.each(ACCOUNT_SCOPED_TABLES)("returns zero rows from %s", async (table) => {
    await clearContext(client);
    const { rows } = await client.query(`select * from ${table}`);
    expect(rows).toHaveLength(0);
  });

  it("cannot read accounts or users", async () => {
    await clearContext(client);
    expect((await client.query("select * from accounts")).rows).toHaveLength(0);
    expect((await client.query("select * from users")).rows).toHaveLength(0);
  });

  it("cannot insert a property by guessing an account id", async () => {
    await clearContext(client);
    await expect(
      client.query(
        "insert into properties (account_id, line1, postcode, itl1_region) values ($1, 'X', 'B1 1AA', 'london')",
        [alice.accountId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("one landlord cannot see another", () => {
  it("shows Alice only her own property", async () => {
    await setContext(client, { accountId: alice.accountId, userId: alice.userId });
    const { rows } = await client.query<{ id: string }>("select id from properties");
    expect(rows.map((r) => r.id)).toEqual([alice.propertyId]);
  });

  it("hides Alice's property from Bob", async () => {
    await setContext(client, { accountId: bob.accountId, userId: bob.userId });
    const { rows } = await client.query("select id from properties where id = $1", [alice.propertyId]);
    expect(rows).toHaveLength(0);
  });

  it("stops Bob updating Alice's property even by exact id", async () => {
    await setContext(client, { accountId: bob.accountId, userId: bob.userId });
    const res = await client.query("update properties set line1 = 'hacked' where id = $1", [alice.propertyId]);
    expect(res.rowCount).toBe(0);

    await setContext(client, { accountId: alice.accountId, userId: alice.userId });
    const { rows } = await client.query<{ line1: string }>("select line1 from properties where id = $1", [alice.propertyId]);
    expect(rows[0]!.line1).not.toBe("hacked");
  });

  it("stops Bob inserting a row into Alice's account", async () => {
    await setContext(client, { accountId: bob.accountId, userId: bob.userId });
    await expect(
      client.query(
        "insert into properties (account_id, line1, postcode, itl1_region) values ($1, 'X', 'B1 1AA', 'london')",
        [alice.accountId],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("hides Alice's user record from Bob", async () => {
    await setContext(client, { accountId: bob.accountId, userId: bob.userId });
    const { rows } = await client.query("select id from users where id = $1", [alice.userId]);
    expect(rows).toHaveLength(0);
  });
});

describe("agent access depends on a live grant", () => {
  it("lets a granted agent read the landlord's property", async () => {
    await setContext(client, { accountId: agency.accountId, userId: agency.userId });
    const { rows } = await client.query("select id from properties where id = $1", [alice.propertyId]);
    expect(rows).toHaveLength(1);
  });

  it("gives an agent with no grant zero rows", async () => {
    await setContext(client, { accountId: rogue.accountId, userId: rogue.userId });
    const { rows } = await client.query("select id from properties where id = $1", [alice.propertyId]);
    expect(rows).toHaveLength(0);
  });

  it("gives a revoked agent zero rows", async () => {
    const carol = await createAccount(client, "Carol");
    const temp = await createAccount(client, "TempAgency", "agent");
    const grantId = await grantAgent(client, carol, temp);

    await setContext(client, { accountId: temp.accountId, userId: temp.userId });
    expect((await client.query("select id from properties where id = $1", [carol.propertyId])).rows).toHaveLength(1);

    await revokeAgent(client, carol, grantId);

    await setContext(client, { accountId: temp.accountId, userId: temp.userId });
    expect((await client.query("select id from properties where id = $1", [carol.propertyId])).rows).toHaveLength(0);
  });

  it("does not let an agent grant itself access", async () => {
    await setContext(client, { accountId: rogue.accountId, userId: rogue.userId });
    await expect(
      client.query("insert into agent_grants (agent_account_id, landlord_account_id) values ($1, $2)", [
        rogue.accountId,
        alice.accountId,
      ]),
    ).rejects.toThrow(/row-level security/i);
  });

  it("does not leak one landlord's data to an agent granted by another", async () => {
    await setContext(client, { accountId: agency.accountId, userId: agency.userId });
    const { rows } = await client.query("select id from properties where id = $1", [bob.propertyId]);
    expect(rows).toHaveLength(0);
  });
});

describe("soft deletes", () => {
  /**
   * RLS answers "whose row is this?". Whether a row is still live is a business
   * rule, enforced by the live_* views and the data access layer. Keeping the
   * two apart matters: when the SELECT policy also filtered deleted_at, setting
   * deleted_at produced a row the policy rejected and soft delete was
   * impossible, because Postgres applies SELECT policies to the updated row.
   */
  it("lets an owner soft-delete their own row", async () => {
    await setContext(client, { accountId: alice.accountId, userId: alice.userId });
    const { rows } = await client.query<{ id: string }>(
      `insert into properties (account_id, line1, postcode, itl1_region)
       values ($1, 'Temp', 'B2 2BB', 'london') returning id`,
      [alice.accountId],
    );
    const tempId = rows[0]!.id;
    const res = await client.query("update properties set deleted_at = now() where id = $1", [tempId]);
    expect(res.rowCount).toBe(1);
  });

  it("hides the deleted row from the live view", async () => {
    await setContext(client, { accountId: alice.accountId, userId: alice.userId });
    const { rows } = await client.query<{ id: string }>(
      `insert into properties (account_id, line1, postcode, itl1_region)
       values ($1, 'Temp2', 'B3 3CC', 'london') returning id`,
      [alice.accountId],
    );
    const tempId = rows[0]!.id;
    expect((await client.query("select id from live_properties where id = $1", [tempId])).rows).toHaveLength(1);

    await client.query("update properties set deleted_at = now() where id = $1", [tempId]);
    expect((await client.query("select id from live_properties where id = $1", [tempId])).rows).toHaveLength(0);
  });

  it("still hides another account's rows through the live view", async () => {
    await setContext(client, { accountId: bob.accountId, userId: bob.userId });
    const { rows } = await client.query("select id from live_properties where id = $1", [alice.propertyId]);
    expect(rows).toHaveLength(0);
  });
});

describe("Law Watch visibility", () => {
  it("hides pending changes from ordinary users and shows approved ones", async () => {
    await clearContext(client);
    await setContext(client, { accountId: alice.accountId, userId: alice.userId, isAdmin: true });
    const src = await client.query<{ id: string }>(
      "insert into law_watch_sources (label, url) values ('T', $1) returning id",
      [`https://example.test/${Date.now()}`],
    );
    const snap = await client.query<{ id: string }>(
      "insert into law_watch_snapshots (source_id, content_sha256, normalised_text) values ($1, 'abc', 'x') returning id",
      [src.rows[0]!.id],
    );
    const pending = await client.query<{ id: string }>(
      "insert into law_watch_changes (source_id, to_snapshot_id, diff) values ($1, $2, 'd') returning id",
      [src.rows[0]!.id, snap.rows[0]!.id],
    );
    const approved = await client.query<{ id: string }>(
      `insert into law_watch_changes (source_id, to_snapshot_id, diff, review_state, published_at)
       values ($1, $2, 'd', 'approved', now()) returning id`,
      [src.rows[0]!.id, snap.rows[0]!.id],
    );

    await setContext(client, { accountId: alice.accountId, userId: alice.userId, isAdmin: false });
    const visible = await client.query<{ id: string }>("select id from law_watch_changes");
    const ids = visible.rows.map((r) => r.id);
    expect(ids).toContain(approved.rows[0]!.id);
    expect(ids).not.toContain(pending.rows[0]!.id);
  });

  it("stops a non-admin publishing a change", async () => {
    await setContext(client, { accountId: alice.accountId, userId: alice.userId, isAdmin: false });
    const res = await client.query("update law_watch_changes set review_state = 'approved'");
    expect(res.rowCount).toBe(0);
  });
});

describe("radar signups are not readable by ordinary accounts", () => {
  it("captures through the definer function but stays invisible", async () => {
    await clearContext(client);
    await client.query("select public_capture_radar_signup($1, $2, $3::itl1_region, $4)", [
      "radar@example.test", "B1 1AA", "west_midlands", 2,
    ]);
    await setContext(client, { accountId: alice.accountId, userId: alice.userId });
    expect((await client.query("select * from radar_signups")).rows).toHaveLength(0);

    await setContext(client, { accountId: alice.accountId, userId: alice.userId, isAdmin: true });
    expect((await client.query("select * from radar_signups")).rows.length).toBeGreaterThan(0);
  });
});
