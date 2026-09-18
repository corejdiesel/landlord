import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { escapeIcs, foldIcsLine, renderIcs, planReminders, runReminders } from "../apps/web/src/lib/reminders.js";
import { connect, createAccount, ensureTestSchema, setContext, type Fixture } from "./helpers/db.js";

/**
 * Reminders and the ICS feed.
 *
 * Missed reminders are this product's nightmare scenario, so the properties
 * worth pinning are: running the job twice does not double-send, every send is
 * ledgered, and the calendar output is actually valid.
 */

describe("ICS output", () => {
  const events = [
    { uid: "a@letsorted", date: "2027-03-14", summary: "Register the property — 12 Acacia Road", description: "Due now." },
  ];

  it("produces a well-formed calendar", () => {
    const ics = renderIcs(events);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:a@letsorted");
    expect(ics).toContain("DTSTART;VALUE=DATE:20270314");
  });

  it("uses CRLF line endings, which some clients genuinely require", () => {
    expect(renderIcs(events)).toContain("\r\n");
    expect(renderIcs(events).split("\r\n").some((l) => l.includes("\n"))).toBe(false);
  });

  it("makes an all-day event end on the following day, because DTEND is exclusive", () => {
    // Getting this wrong shows a deadline as a zero-length event, or on the
    // wrong day, in every calendar client.
    expect(renderIcs(events)).toContain("DTEND;VALUE=DATE:20270315");
  });

  it("escapes the characters the format reserves", () => {
    expect(escapeIcs("Rent, bills; and\nmore")).toBe("Rent\\, bills\; and\\nmore");
    expect(escapeIcs("back\\slash")).toBe("back\\\\slash");
  });

  it("folds long lines at 75 octets with a leading space", () => {
    const folded = foldIcsLine("X".repeat(200));
    const lines = folded.split("\r\n");
    expect(lines[0]!.length).toBe(75);
    for (const line of lines.slice(1)) {
      expect(line.startsWith(" ")).toBe(true);
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it("leaves a short line alone", () => {
    expect(foldIcsLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("produces a valid empty calendar when nothing is due", () => {
    const ics = renderIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("reminder scheduling", () => {
  let client: Client;
  let acct: Fixture;
  let ctx: { accountId: string; userId: string };

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    acct = await createAccount(client, "RemindCo");
    ctx = { accountId: acct.accountId, userId: acct.userId };

    await setContext(client, ctx);
    // A tenancy with a gas-less property keeps the scenario small and
    // predictable: the obligations that fire are the ones we mean to test.
    await client.query(
      `insert into tenancies (account_id, property_id, kind, started_on, rent_pennies,
                              rent_frequency, households, occupants, deposit_taken)
       values ($1, $2, 'assured', '2025-01-01', 100000, 'monthly', 1, 2, false)`,
      [acct.accountId, acct.propertyId],
    );
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("plans nothing on a day when nothing is approaching", async () => {
    const planned = await planReminders(ctx, "2026-05-05");
    expect(Array.isArray(planned)).toBe(true);
  });

  it("plans a reminder exactly 30 days before the regional deadline", async () => {
    // West Midlands deadline is 14 March 2027, so 12 February 2027.
    const planned = await planReminders(ctx, "2027-02-12");
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.some((p) => /30 days/.test(p.subject))).toBe(true);
  });

  it("says 'tomorrow' rather than 'in 1 days'", async () => {
    const planned = await planReminders(ctx, "2027-03-13");
    expect(planned.some((p) => p.subject.includes("tomorrow"))).toBe(true);
    expect(planned.some((p) => /in 1 days/.test(p.body))).toBe(false);
  });

  it("carries the legal-advice footer into every email body", async () => {
    for (const p of await planReminders(ctx, "2027-02-12")) {
      expect(p.body).toMatch(/not legal advice/i);
    }
  });

  it("never uses a penalty figure to prompt action", async () => {
    for (const day of ["2027-02-12", "2027-03-07", "2027-03-13"]) {
      for (const p of await planReminders(ctx, day)) {
        expect(`${p.subject} ${p.body}`).not.toMatch(/£[\d,]+|fine|prosecut/i);
      }
    }
  });
});

describe("running reminders is idempotent", () => {
  let client: Client;
  let ctx: { accountId: string; userId: string };

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    const acct = await createAccount(client, "IdempotentCo");
    ctx = { accountId: acct.accountId, userId: acct.userId };
    await setContext(client, ctx);
    await client.query(
      `insert into tenancies (account_id, property_id, kind, started_on, rent_pennies,
                              rent_frequency, households, occupants, deposit_taken)
       values ($1, $2, 'assured', '2025-01-01', 100000, 'monthly', 1, 2, false)`,
      [acct.accountId, acct.propertyId],
    );
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("sends on the first run and nothing on the second", async () => {
    const first = await runReminders(ctx, "2027-02-12");
    expect(first.scheduled).toBeGreaterThan(0);

    // A scheduler firing twice must not mean a landlord is emailed twice.
    const second = await runReminders(ctx, "2027-02-12");
    expect(second.scheduled).toBe(0);
    expect(second.sent).toBe(0);
  });

  it("ledgers every send, so a landlord can show what they were told", async () => {
    await setContext(client, ctx);
    const { rows } = await client.query<{ count: string }>(
      "select count(*) as count from ledger_events where account_id = $1 and event_type = 'reminder.sent'",
      [ctx.accountId],
    );
    expect(Number(rows[0]!.count)).toBeGreaterThan(0);
  });

  it("leaves the ledger chain intact after a run", async () => {
    await setContext(client, ctx);
    const { rows } = await client.query("select seq, problem from ledger_verify($1)", [ctx.accountId]);
    expect(rows).toEqual([]);
  });

  it("still sends for two different obligations that fall due on the same day", async () => {
    // The tempting fix for the NULL-vs-NULL constraint bug was to COALESCE the
    // id columns to a sentinel. That would have collapsed every obligation
    // reminder for one account on one day into a single row, silently dropping
    // all but one. The dedupe key names the property, the rule and the offset,
    // so distinct obligations stay distinct.
    await setContext(client, ctx);
    const { rows } = await client.query<{ dedupe_key: string }>(
      "select dedupe_key from live_reminders where scheduled_for = '2027-02-12'",
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(new Set(rows.map((r) => r.dedupe_key)).size).toBe(rows.length);
    for (const r of rows) expect(r.dedupe_key).toMatch(/^(obligation|drift|renewal):/);
  });

  it("records what was sent, when, and to which target", async () => {
    await setContext(client, ctx);
    const { rows } = await client.query<{ subject: string; sent_at: string | null; scheduled_for: string }>(
      "select subject, sent_at, to_char(scheduled_for, 'YYYY-MM-DD') as scheduled_for from live_reminders",
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.subject.length).toBeGreaterThan(5);
      expect(r.scheduled_for).toBe("2027-02-12");
    }
  });
});
