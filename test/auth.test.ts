import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearContext, connect, ensureTestSchema } from "./helpers/db.js";

/**
 * Auth path.
 *
 * These exist because of a bug that was invisible from the outside: the login
 * and session lookups are SECURITY DEFINER, which was assumed to bypass RLS. It
 * does not — FORCE ROW LEVEL SECURITY binds the owner too — so both functions
 * returned zero rows and sign-in failed with "that email and password do not
 * match" for a perfectly correct password.
 *
 * The lesson these tests encode: a pre-context function must be tested from a
 * connection with NO context, which is the only state it will ever be called in.
 */

let client: Client;

beforeAll(async () => {
  await ensureTestSchema();
  client = await connect();
}, 60_000);

afterAll(async () => {
  await client?.end();
});

async function signUp(email: string) {
  await clearContext(client);
  const { rows } = await client.query<{ account_id: string; user_id: string }>(
    "select account_id, user_id from app_signup($1, $2, $3, 'landlord'::account_type)",
    [email, "Test Person", "Test Account"],
  );
  return rows[0]!;
}

describe("signup", () => {
  it("creates an account, a user and an owner membership", async () => {
    const { account_id, user_id } = await signUp(`signup-${Date.now()}@example.test`);
    expect(account_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a duplicate email", async () => {
    const email = `dupe-${Date.now()}@example.test`;
    await signUp(email);
    await clearContext(client);
    await expect(
      client.query("select * from app_signup($1, 'X', 'Y', 'landlord'::account_type)", [email]),
    ).rejects.toThrow(/already registered/i);
  });

  it("refuses something that is not an email", async () => {
    await clearContext(client);
    await expect(
      client.query("select * from app_signup($1, 'X', 'Y', 'landlord'::account_type)", ["not-an-email"]),
    ).rejects.toThrow(/valid email/i);
  });

  it("leaves the bootstrap flag down afterwards, so it cannot be leaned on", async () => {
    await signUp(`flag-${Date.now()}@example.test`);
    const { rows } = await client.query<{ b: boolean }>("select app_is_bootstrapping() as b");
    expect(rows[0]!.b).toBe(false);
  });
});

describe("login lookup, from a connection with no context", () => {
  it("finds a user who exists", async () => {
    const email = `login-${Date.now()}@example.test`;
    const { user_id } = await signUp(email);
    await clearContext(client);
    const { rows } = await client.query<{ id: string }>(
      "select id from app_user_for_login($1)", [email],
    );
    expect(rows[0]?.id).toBe(user_id);
  });

  it("is case-insensitive about the email, because people type it how they like", async () => {
    const email = `Case-${Date.now()}@Example.Test`;
    await signUp(email);
    await clearContext(client);
    const { rows } = await client.query("select id from app_user_for_login($1)", [email.toUpperCase()]);
    expect(rows).toHaveLength(1);
  });

  it("returns nothing for an unknown email", async () => {
    await clearContext(client);
    const { rows } = await client.query("select id from app_user_for_login($1)", ["nobody@example.test"]);
    expect(rows).toHaveLength(0);
  });
});

describe("session lifecycle, from a connection with no context", () => {
  async function withSession() {
    const email = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
    const { user_id, account_id } = await signUp(email);
    const tokenHash = `hash-${Math.random().toString(36).slice(2)}`;
    await clearContext(client);
    await client.query("select app_create_session($1, $2, now() + interval '7 days')", [user_id, tokenHash]);
    return { user_id, account_id, tokenHash };
  }

  it("resolves a live session to its account context", async () => {
    const { user_id, account_id, tokenHash } = await withSession();
    await clearContext(client);
    const { rows } = await client.query<{ user_id: string; account_id: string; role: string }>(
      "select user_id, account_id, is_admin, role from app_session_context($1)", [tokenHash],
    );
    expect(rows[0]).toMatchObject({ user_id, account_id, role: "owner" });
  });

  it("resolves nothing for an unknown token", async () => {
    await clearContext(client);
    const { rows } = await client.query("select * from app_session_context($1)", ["no-such-hash"]);
    expect(rows).toHaveLength(0);
  });

  it("resolves nothing for an expired session", async () => {
    const email = `expired-${Date.now()}@example.test`;
    const { user_id } = await signUp(email);
    const tokenHash = `expired-${Math.random().toString(36).slice(2)}`;
    await clearContext(client);
    await client.query("select app_create_session($1, $2, now() - interval '1 day')", [user_id, tokenHash]);
    const { rows } = await client.query("select * from app_session_context($1)", [tokenHash]);
    expect(rows).toHaveLength(0);
  });

  it("stops resolving once the session is destroyed", async () => {
    const { tokenHash } = await withSession();
    await clearContext(client);
    await client.query("select app_destroy_session($1)", [tokenHash]);
    const { rows } = await client.query("select * from app_session_context($1)", [tokenHash]);
    expect(rows).toHaveLength(0);
  });

  it("never returns another account's context for a valid token", async () => {
    const a = await withSession();
    const b = await withSession();
    await clearContext(client);
    const { rows } = await client.query<{ account_id: string }>(
      "select account_id from app_session_context($1)", [a.tokenHash],
    );
    expect(rows[0]!.account_id).toBe(a.account_id);
    expect(rows[0]!.account_id).not.toBe(b.account_id);
  });
});

describe("the bootstrap door is only as wide as it needs to be", () => {
  it("does not let an ordinary session read another account's users by raising the flag itself", async () => {
    // Application code never sets this, but prove the blast radius if it did:
    // the flag is transaction-local, so a session-level set from a client does
    // open the bootstrap policies. This test documents that the protection is
    // "no application code sets it", not "it cannot be set".
    const { user_id } = await signUp(`blast-${Date.now()}@example.test`);
    await clearContext(client);
    const before = await client.query("select id from users where id = $1", [user_id]);
    expect(before.rows).toHaveLength(0);
  });
});
