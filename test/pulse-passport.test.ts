import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, newPassportSlug, newToken } from "../apps/web/src/lib/tokens.js";
import { answerPulse, createPulseRequest, lookupPulse } from "../apps/web/src/lib/pulse.js";
import {
  buildPassportView, createPassport, DEFAULT_VISIBILITY, PUBLIC_FIELDS,
  revokePassport, stripBuildingNumber,
} from "../apps/web/src/lib/passport.js";
import { clearContext, connect, createAccount, ensureTestSchema, setContext, type Fixture } from "./helpers/db.js";

/**
 * Household Pulse and Tenant Passport.
 *
 * Both are reachable without a login, so the privacy properties are the whole
 * point. These tests exist to make the guarantees enforceable rather than
 * aspirational.
 */

describe("tokens", () => {
  it("are long enough not to be guessable", () => {
    expect(newToken().length).toBeGreaterThanOrEqual(43);
    expect(newPassportSlug().length).toBeGreaterThanOrEqual(22);
  });

  it("are different every time", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => newToken()));
    expect(tokens.size).toBe(100);
  });

  it("hash to a different value for a different purpose, so one cannot be replayed as another", () => {
    const token = newToken();
    expect(hashToken(token, "pulse")).not.toBe(hashToken(token, "attestation"));
    expect(hashToken(token, "pulse")).toBe(hashToken(token, "pulse"));
  });

  it("hash to 64 hex characters", () => {
    expect(hashToken(newToken(), "pulse")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Household Pulse", () => {
  let client: Client;
  let acct: Fixture;
  let ctx: { accountId: string; userId: string };

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    acct = await createAccount(client, "PulseCo");
    ctx = { accountId: acct.accountId, userId: acct.userId };
    await setContext(client, ctx);
    await client.query(
      `insert into tenancies (account_id, property_id, kind, started_on, rent_pennies,
                              rent_frequency, households, occupants)
       values ($1, $2, 'assured', '2025-01-01', 100000, 'monthly', 1, 2)`,
      [acct.accountId, acct.propertyId],
    );
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("stores only the hash of the link token", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    await setContext(client, ctx);
    const { rows } = await client.query<{ token_hash: string }>(
      "select token_hash from live_pulse_requests order by created_at desc limit 1",
    );
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toBe(hashToken(token, "pulse"));
  });

  it("resolves a valid link without any session", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    await clearContext(client);
    const result = await lookupPulse(token);
    expect(result.ok).toBe(true);
  });

  it("does not resolve a made-up token", async () => {
    const result = await lookupPulse(newToken());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("does not resolve a short or empty token", async () => {
    expect((await lookupPulse("")).ok).toBe(false);
    expect((await lookupPulse("abc")).ok).toBe(false);
  });

  it("records an answer and refuses a second one on the same link", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    expect(await answerPulse(token, 2, 4)).toEqual({ ok: true });

    const again = await answerPulse(token, 3, 5);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already been used/i);
  });

  it("stores nothing but two numbers and a timestamp", async () => {
    await setContext(client, ctx);
    const { rows } = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'pulse_responses' order by column_name`,
    );
    const columns = rows.map((r) => r.column_name).sort();
    // If this test fails because a column was added, that is the test doing its
    // job: the privacy claim on the tenant-facing page is that we collect two
    // numbers and nothing else.
    expect(columns).toEqual([
      "account_id", "answered_at", "created_at", "deleted_at",
      "households", "id", "occupants", "pulse_request_id", "updated_at",
    ]);
  });

  it("refuses answers that are out of range", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    expect((await answerPulse(token, -1, 4)).ok).toBe(false);
    expect((await answerPulse(token, 2, 10_000)).ok).toBe(false);
    expect((await answerPulse(token, 1.5, 4)).ok).toBe(false);
  });

  it("refuses fewer people than households, which cannot be true", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    const result = await answerPulse(token, 5, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/fewer people than households/);
  });

  it("refuses an expired link", async () => {
    const { token } = await createPulseRequest(ctx, acct.propertyId);
    await setContext(client, ctx);
    await client.query(
      "update pulse_requests set expires_at = now() - interval '1 day' where token_hash = $1",
      [hashToken(token, "pulse")],
    );
    const result = await lookupPulse(token);
    expect(result.ok).toBe(false);
  });
});

describe("Tenant Passport", () => {
  let client: Client;
  let acct: Fixture;
  let ctx: { accountId: string; userId: string };

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    acct = await createAccount(client, "PassportCo");
    ctx = { accountId: acct.accountId, userId: acct.userId };
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("never shows the building number, only the street", () => {
    expect(stripBuildingNumber("12 Acacia Road")).toBe("Acacia Road");
    expect(stripBuildingNumber("12A Acacia Road")).toBe("Acacia Road");
    expect(stripBuildingNumber("Flat 4, 18 Everleigh House")).toBe("Everleigh House");
    expect(stripBuildingNumber("Apartment 12, Dock Street")).toBe("Dock Street");
    expect(stripBuildingNumber("Rose Cottage")).toBe("Rose Cottage");
  });

  it("keeps the registration number off by default", () => {
    expect(DEFAULT_VISIBILITY.registration_number).toBe(false);
    expect(DEFAULT_VISIBILITY.registered).toBe(true);
  });

  it("has no field in the allowlist that could identify the landlord", () => {
    // The allowlist IS the security boundary. A field added to `properties`
    // cannot leak unless someone deliberately adds it here.
    for (const field of PUBLIC_FIELDS) {
      expect(field).not.toMatch(/landlord|correspondence|owner|email|phone|dob|birth|address/);
    }
  });

  it("shows only the fields the landlord switched on", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId, {
      registered: true, gas_in_date: true,
      electrical_in_date: false, epc_rating: false,
      licence_held: false, deposit_scheme: false,
    });
    const view = await buildPassportView(slug, "2027-01-20");
    expect(view).not.toBeNull();
    const keys = view!.fields.map((f) => f.key);
    expect(keys).toContain("registered");
    expect(keys).toContain("gas_in_date");
    expect(keys).not.toContain("epc_rating");
    expect(keys).not.toContain("deposit_scheme");
  });

  it("never includes the registration number unless it was switched on", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId);
    const view = await buildPassportView(slug, "2027-01-20");
    expect(view!.fields.map((f) => f.key)).not.toContain("registration_number");
  });

  it("shows the street but not the house number", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId);
    const view = await buildPassportView(slug, "2027-01-20");
    // The fixture address is "1 <Name> Road".
    expect(view!.location).not.toMatch(/^\d/);
    expect(view!.location).toMatch(/Road/);
  });

  it("returns nothing for an unknown slug", async () => {
    expect(await buildPassportView(newPassportSlug(), "2027-01-20")).toBeNull();
  });

  it("returns nothing for a short slug, rather than scanning", async () => {
    expect(await buildPassportView("abc", "2027-01-20")).toBeNull();
  });

  it("stops resolving once revoked", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId);
    expect(await buildPassportView(slug, "2027-01-20")).not.toBeNull();
    await revokePassport(ctx, slug);
    expect(await buildPassportView(slug, "2027-01-20")).toBeNull();
  });

  it("stops resolving once expired", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId);
    await setContext(client, ctx);
    await client.query("update passports set expires_at = now() - interval '1 day' where slug = $1", [slug]);
    expect(await buildPassportView(slug, "2027-01-20")).toBeNull();
  });

  it("does not put the live public link in the exportable ledger", async () => {
    const { slug } = await createPassport(ctx, acct.propertyId);
    await setContext(client, ctx);
    const { rows } = await client.query<{ payload: Record<string, unknown> }>(
      "select payload from ledger_events where account_id = $1 and event_type = 'passport.created'",
      [ctx.accountId],
    );
    for (const r of rows) {
      expect(JSON.stringify(r.payload)).not.toContain(slug);
    }
  });
});
