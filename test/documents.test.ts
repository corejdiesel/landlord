import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addressScore, normaliseAddress, scanForViruses, sniffMimeType,
} from "../apps/web/src/lib/documents-service.js";
import { clearContext, connect, createAccount, ensureTestSchema, setContext, type Fixture } from "./helpers/db.js";

/**
 * Cert Inbox.
 *
 * The bar these tests hold: an extraction must never reach compliance state
 * without a human, and a certificate must never be attached to the wrong
 * property. The second would mark one property compliant while leaving another
 * exposed, which is worse than doing nothing at all.
 */

describe("MIME sniffing", () => {
  const pdf = Buffer.from("%PDF-1.7\n...");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

  it("identifies real files from their magic bytes", () => {
    expect(sniffMimeType(pdf, "application/pdf")).toBe("application/pdf");
    expect(sniffMimeType(png, "image/png")).toBe("image/png");
    expect(sniffMimeType(jpeg, "image/jpeg")).toBe("image/jpeg");
  });

  it("trusts the bytes over the declared type", () => {
    // An attacker controls the header; they do not control the first four bytes.
    expect(sniffMimeType(pdf, "image/png")).toBe("application/pdf");
  });

  it("rejects a file whose bytes match nothing we accept", () => {
    expect(sniffMimeType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "application/pdf")).toBeNull();
  });

  it("rejects a script pretending to be a PDF", () => {
    expect(sniffMimeType(Buffer.from("<?php system($_GET['c']); ?>"), "application/pdf")).toBeNull();
  });

  it("accepts plain text only when it is declared and actually printable", () => {
    expect(sniffMimeType(Buffer.from("Gas safety record\n01/06/2026"), "text/plain")).toBe("text/plain");
    expect(sniffMimeType(Buffer.from([0x00, 0x01, 0x02, 0x03]), "text/plain")).toBeNull();
  });

  it("rejects an empty buffer", () => {
    expect(sniffMimeType(Buffer.alloc(0), "application/pdf")).toBeNull();
  });
});

describe("the virus scan hook", () => {
  it("passes an ordinary document", async () => {
    expect((await scanForViruses(Buffer.from("%PDF-1.7"))).clean).toBe(true);
  });

  it("refuses the EICAR test string, so the refusal path is real", async () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    expect((await scanForViruses(eicar)).clean).toBe(false);
  });

  it("says plainly that no scanner is configured", async () => {
    expect((await scanForViruses(Buffer.from("ok"))).scanner).toMatch(/no scanner/i);
  });
});

describe("address matching", () => {
  it("normalises punctuation and case away", () => {
    expect(normaliseAddress("12 Acacia Road, Birmingham")).toBe("12 acacia road birmingham");
    expect(normaliseAddress("B13  9QT")).toBe("b13 9qt");
  });

  it("scores an exact address highly", () => {
    expect(addressScore(normaliseAddress("12 Acacia Road"), normaliseAddress("12 Acacia Road")))
      .toBeGreaterThan(0.9);
  });

  it("scores a different house number on the same street very low", () => {
    // This is the case that matters most: 12 and 14 Acacia Road are different
    // properties, and a near-miss here attaches a certificate to the wrong one.
    const score = addressScore(normaliseAddress("14 Acacia Road"), normaliseAddress("12 Acacia Road"));
    expect(score).toBeLessThan(0.4);
  });

  it("scores an unrelated address near zero", () => {
    expect(addressScore(normaliseAddress("5 Hollybank Terrace"), normaliseAddress("12 Acacia Road")))
      .toBeLessThan(0.3);
  });

  it("tolerates a missing town", () => {
    expect(addressScore(normaliseAddress("12 Acacia Road"), normaliseAddress("12 Acacia Road Birmingham")))
      .toBeGreaterThan(0.6);
  });
});

describe("documents are inert until confirmed", () => {
  let client: Client;
  let acct: Fixture;

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    acct = await createAccount(client, "DocCo");
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("stores an extraction with confirmed_at null", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const { rows } = await client.query<{ id: string; confirmed_at: string | null }>(
      `insert into documents (account_id, property_id, kind, issued_on, expires_on, extraction, confidence)
       values ($1, $2, 'gas_safety_record', '2026-06-01', '2027-06-01',
               '{"kind":"gas_safety_record"}'::jsonb, '{"issued_on":0.9}'::jsonb)
       returning id, confirmed_at`,
      [acct.accountId, acct.propertyId],
    );
    expect(rows[0]!.confirmed_at).toBeNull();
  });

  it("keeps per-field confidence so the confirm screen can highlight the weak ones", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const { rows } = await client.query<{ confidence: Record<string, number> }>(
      `insert into documents (account_id, property_id, kind, confidence)
       values ($1, $2, 'eicr', '{"issued_on":0.93,"property_address":0.41}'::jsonb)
       returning confidence`,
      [acct.accountId, acct.propertyId],
    );
    expect(rows[0]!.confidence["property_address"]).toBeLessThan(0.5);
  });

  it("records who confirmed it and when", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const inserted = await client.query<{ id: string }>(
      `insert into documents (account_id, property_id, kind) values ($1, $2, 'epc') returning id`,
      [acct.accountId, acct.propertyId],
    );
    await client.query(
      "update documents set confirmed_by = $2, confirmed_at = now() where id = $1",
      [inserted.rows[0]!.id, acct.userId],
    );
    const { rows } = await client.query<{ confirmed_by: string; confirmed_at: string }>(
      "select confirmed_by, confirmed_at from documents where id = $1", [inserted.rows[0]!.id],
    );
    expect(rows[0]!.confirmed_by).toBe(acct.userId);
    expect(rows[0]!.confirmed_at).not.toBeNull();
  });

  it("hides one account's documents from another", async () => {
    const other = await createAccount(client, "OtherDocCo");
    await setContext(client, { accountId: other.accountId, userId: other.userId });
    const { rows } = await client.query("select id from live_documents where account_id = $1", [acct.accountId]);
    expect(rows).toHaveLength(0);
  });
});

describe("inbound email routing", () => {
  let client: Client;
  let acct: Fixture;

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    acct = await createAccount(client, "InboxCo");
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("resolves an account from its inbound token, with no session context", async () => {
    await setContext(client, { accountId: acct.accountId, userId: acct.userId });
    const { rows: tokenRows } = await client.query<{ inbound_token: string }>(
      "select inbound_token from live_accounts where id = $1", [acct.accountId],
    );
    const token = tokenRows[0]!.inbound_token;

    await clearContext(client);
    const { rows } = await client.query<{ account_id: string; user_id: string }>(
      "select account_id, user_id from app_account_for_inbound_token($1)", [token],
    );
    expect(rows[0]!.account_id).toBe(acct.accountId);
    expect(rows[0]!.user_id).toBe(acct.userId);
  });

  it("resolves nothing for an unknown token, rather than falling back to any account", async () => {
    await clearContext(client);
    const { rows } = await client.query(
      "select * from app_account_for_inbound_token($1)", ["deadbeefdeadbeef00"],
    );
    expect(rows).toHaveLength(0);
  });

  it("gives every account a distinct, long inbound token", async () => {
    const second = await createAccount(client, "InboxCo2");
    await clearContext(client);
    await client.query("select set_config('app.bootstrap', 'on', false)");
    const { rows } = await client.query<{ inbound_token: string }>(
      "select inbound_token from accounts where id = any($1::uuid[])",
      [[acct.accountId, second.accountId]],
    );
    await client.query("select set_config('app.bootstrap', 'off', false)");
    const tokens = rows.map((r) => r.inbound_token);
    expect(new Set(tokens).size).toBe(2);
    for (const t of tokens) expect(t).toMatch(/^[a-f0-9]{18}$/);
  });
});
