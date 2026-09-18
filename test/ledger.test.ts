import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearContext, connect, connectBypassingRls, createAccount, ensureTestSchema, setContext, type Fixture } from "./helpers/db.js";

/**
 * Evidence Ledger.
 *
 * The product claim is modest and specific: a landlord can show a clear record
 * of what they did and when, and that record can be checked. These tests are
 * what makes that claim honest — they prove the chain detects tampering, that
 * the database itself refuses edits, and that a chain cannot be replayed under
 * another account.
 */

let client: Client;
/** Simulates direct database access; see connectBypassingRls. */
let attacker: Client;
let acct: Fixture;
let other: Fixture;

beforeAll(async () => {
  await ensureTestSchema();
  client = await connect();
  attacker = await connectBypassingRls();
  acct = await createAccount(client, "LedgerCo");
  other = await createAccount(client, "OtherCo");
}, 60_000);

afterAll(async () => {
  await client?.end();
  await attacker?.end();
});

async function append(f: Fixture, type: string, payload: unknown) {
  await setContext(client, { accountId: f.accountId, userId: f.userId });
  const { rows } = await client.query<{ seq: string; hash: string; prev_hash: string }>(
    "select seq, hash, prev_hash from ledger_append($1, $2, $3::jsonb)",
    [f.accountId, type, JSON.stringify(payload)],
  );
  return rows[0]!;
}

async function verify(f: Fixture) {
  await setContext(client, { accountId: f.accountId, userId: f.userId });
  const { rows } = await client.query<{ seq: string; problem: string }>(
    "select seq, problem from ledger_verify($1)",
    [f.accountId],
  );
  return rows;
}

describe("appending", () => {
  it("starts at sequence 1 and increments", async () => {
    const a = await append(acct, "document.uploaded", { document_id: "d1" });
    const b = await append(acct, "document.confirmed", { document_id: "d1" });
    const c = await append(acct, "drift.opened", { field: "rent_pennies" });
    expect(a.seq).toBe("1");
    expect(b.seq).toBe("2");
    expect(c.seq).toBe("3");
  });

  it("links each row to the one before it", async () => {
    const rows = await client.query<{ seq: string; hash: string; prev_hash: string }>(
      "select seq, hash, prev_hash from ledger_events where account_id = $1 order by seq",
      [acct.accountId],
    );
    for (let i = 1; i < rows.rows.length; i++) {
      expect(rows.rows[i]!.prev_hash).toBe(rows.rows[i - 1]!.hash);
    }
  });

  it("anchors the genesis row to the account, so a chain cannot be replayed elsewhere", async () => {
    const mine = await client.query<{ prev_hash: string }>(
      "select prev_hash from ledger_events where account_id = $1 and seq = 1",
      [acct.accountId],
    );
    await append(other, "document.uploaded", { document_id: "d1" });
    await setContext(client, { accountId: other.accountId, userId: other.userId });
    const theirs = await client.query<{ prev_hash: string }>(
      "select prev_hash from ledger_events where account_id = $1 and seq = 1",
      [other.accountId],
    );
    expect(mine.rows[0]!.prev_hash).not.toBe(theirs.rows[0]!.prev_hash);
  });

  it("keeps each account's sequence independent", async () => {
    await setContext(client, { accountId: other.accountId, userId: other.userId });
    const { rows } = await client.query<{ seq: string }>(
      "select seq from ledger_events where account_id = $1 order by seq",
      [other.accountId],
    );
    expect(rows.map((r) => r.seq)).toEqual(["1"]);
  });

  it("does not fork the chain under concurrent appends", async () => {
    const racer = await createAccount(client, "RaceCo");
    // Separate connections, so these genuinely contend rather than queue on one
    // client. The advisory lock in ledger_append is what has to hold here.
    const clients = await Promise.all([connect(), connect(), connect(), connect(), connect()]);
    try {
      await Promise.all(
        clients.map(async (c, i) => {
          await c.query("select set_config('app.current_account_id', $1, false)", [racer.accountId]);
          await c.query("select set_config('app.current_user_id', $1, false)", [racer.userId]);
          await c.query("select ledger_append($1, $2, $3::jsonb)", [
            racer.accountId, "concurrent.event", JSON.stringify({ i }),
          ]);
        }),
      );
      await setContext(client, { accountId: racer.accountId, userId: racer.userId });
      const { rows } = await client.query<{ seq: string }>(
        "select seq from ledger_events where account_id = $1 order by seq",
        [racer.accountId],
      );
      expect(rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5]);
      expect(await verify(racer)).toEqual([]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });
});

describe("verification", () => {
  it("reports an intact chain as having no problems", async () => {
    expect(await verify(acct)).toEqual([]);
  });

  it("reports an empty chain as intact", async () => {
    const fresh = await createAccount(client, "EmptyCo");
    expect(await verify(fresh)).toEqual([]);
  });
});

describe("the database refuses to let history be edited", () => {
  /**
   * There are two independent defences, and they fail differently:
   *
   *  1. RLS grants no UPDATE or DELETE policy on ledger_events, so an ordinary
   *     session's statement matches zero rows and silently does nothing.
   *  2. Triggers reject the operation outright for anyone who gets past RLS.
   *
   * Asserting them separately is the point: if the triggers were removed, test
   * (1) would still pass, so it cannot stand in for (2).
   */
  it("matches zero rows for an UPDATE from the account that owns the chain", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const res = await client.query(
      "update ledger_events set payload = '{\"tampered\":true}'::jsonb where account_id = $1",
      [acct.accountId],
    );
    expect(res.rowCount).toBe(0);
  });

  it("matches zero rows for a DELETE from the account that owns the chain", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const res = await client.query("delete from ledger_events where account_id = $1", [acct.accountId]);
    expect(res.rowCount).toBe(0);
  });

  it("rejects an UPDATE outright for a caller that bypasses RLS", async () => {
    await expect(
      attacker.query("update ledger_events set payload = '{\"tampered\":true}'::jsonb where account_id = $1", [
        acct.accountId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects a DELETE outright for a caller that bypasses RLS", async () => {
    await expect(
      attacker.query("delete from ledger_events where account_id = $1", [acct.accountId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects a TRUNCATE, which would otherwise sidestep the row triggers", async () => {
    await expect(attacker.query("truncate ledger_events")).rejects.toThrow(/append-only/i);
  });
});

describe("tamper detection", () => {
  /**
   * The triggers block edits through the normal path, so to prove the chain
   * itself detects tampering we have to simulate an attacker who got past them —
   * someone with direct database access, which is exactly the threat the hash
   * chain exists for. These tests disable the trigger, corrupt a row, and check
   * that verification notices.
   */
  async function withTriggersDisabled<T>(fn: () => Promise<T>): Promise<T> {
    await attacker.query("alter table ledger_events disable trigger ledger_events_no_update");
    try {
      return await fn();
    } finally {
      await attacker.query("alter table ledger_events enable trigger ledger_events_no_update");
    }
  }

  it("notices an altered payload", async () => {
    const victim = await createAccount(client, "TamperPayload");
    await append(victim, "gas.confirmed", { expires_on: "2027-06-01" });
    await append(victim, "gas.confirmed", { expires_on: "2028-06-01" });

    await withTriggersDisabled(async () => {
      await attacker.query(
        `update ledger_events set payload = '{"expires_on":"2099-01-01"}'::jsonb
         where account_id = $1 and seq = 1`,
        [victim.accountId],
      );
    });

    const problems = await verify(victim);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.problem.includes("payload does not match"))).toBe(true);
  });

  it("notices a payload rewritten together with its own hash, because the chain no longer links", async () => {
    const victim = await createAccount(client, "TamperClever");
    await append(victim, "drift.closed", { field: "rent_pennies" });
    await append(victim, "drift.closed", { field: "occupants" });

    await withTriggersDisabled(async () => {
      // A careful attacker updates the payload AND its recorded hash.
      await attacker.query(
        `update ledger_events
            set payload = '{"field":"nothing_to_see"}'::jsonb,
                payload_sha256 = encode(digest('{"field":"nothing_to_see"}', 'sha256'), 'hex')
          where account_id = $1 and seq = 1`,
        [victim.accountId],
      );
    });

    const problems = await verify(victim);
    // The row hash still commits to the old payload hash, so the row fails,
    // and row 2's prev_hash no longer matches row 1.
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.problem.includes("row hash does not match"))).toBe(true);
  });

  it("notices a removed row as a sequence gap", async () => {
    const victim = await createAccount(client, "TamperDelete");
    await append(victim, "a", { n: 1 });
    await append(victim, "b", { n: 2 });
    await append(victim, "c", { n: 3 });

    await attacker.query("alter table ledger_events disable trigger ledger_events_no_delete");
    try {
      await attacker.query("delete from ledger_events where account_id = $1 and seq = 2", [victim.accountId]);
    } finally {
      await attacker.query("alter table ledger_events enable trigger ledger_events_no_delete");
    }

    const problems = await verify(victim);
    expect(problems.some((p) => p.problem.includes("sequence gap"))).toBe(true);
  });

  it("notices an altered event type", async () => {
    const victim = await createAccount(client, "TamperType");
    await append(victim, "reminder.sent", { channel: "email" });

    await withTriggersDisabled(async () => {
      await attacker.query("update ledger_events set event_type = 'reminder.opened' where account_id = $1", [
        victim.accountId,
      ]);
    });

    const problems = await verify(victim);
    expect(problems.some((p) => p.problem.includes("row hash does not match"))).toBe(true);
  });

  it("leaves other accounts' chains intact when one is tampered with", async () => {
    expect(await verify(acct)).toEqual([]);
  });
});

describe("ledger visibility", () => {
  it("hides one account's chain from another", async () => {
    await setContext(client, { accountId: other.accountId, userId: other.userId });
    const { rows } = await client.query("select * from ledger_events where account_id = $1", [acct.accountId]);
    expect(rows).toHaveLength(0);
  });

  it("stops an account appending to someone else's chain", async () => {
    await setContext(client, { accountId: other.accountId, userId: other.userId });
    await expect(
      client.query("select ledger_append($1, 'forged', '{}'::jsonb)", [acct.accountId]),
    ).rejects.toThrow(/row-level security/i);
  });
});
