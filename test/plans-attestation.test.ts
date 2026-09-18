import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  can, checkPropertyLimit, monthlyCostPennies, nextPlanFor, PLANS, planFor,
} from "../apps/web/src/lib/plans.js";
import {
  answerAttestation, lookupAttestation, requestAttestation,
} from "../apps/web/src/lib/attestation.js";
import { newToken } from "../apps/web/src/lib/tokens.js";
import { connect, createAccount, ensureTestSchema, grantAgent, setContext, type Fixture } from "./helpers/db.js";

describe("plan capabilities", () => {
  it("gives the free plan the acquisition features and nothing more", () => {
    expect(can("free", "radar")).toBe(true);
    expect(can("free", "rehearsal")).toBe(true);
    expect(can("free", "cert_inbox")).toBe(false);
    expect(can("free", "agent_workspace")).toBe(false);
  });

  it("gives a landlord plan the compliance features but no agent features", () => {
    expect(can("landlord", "drift_clock")).toBe(true);
    expect(can("landlord", "defence_file")).toBe(true);
    expect(can("landlord", "attestations")).toBe(false);
  });

  it("adds portfolio extras on the portfolio plan", () => {
    expect(can("portfolio", "csv_import")).toBe(true);
    expect(can("portfolio", "hmo_mode")).toBe(true);
    expect(can("landlord", "csv_import")).toBe(false);
  });

  it("gives the agent plan everything, including the agent-only features", () => {
    for (const capability of PLANS.portfolio.capabilities) {
      expect(can("agent", capability), capability).toBe(true);
    }
    expect(can("agent", "attestations")).toBe(true);
    expect(can("agent", "client_branding")).toBe(true);
  });

  it("treats an unknown plan as free rather than as unlimited", () => {
    // Failing open on billing is how you give the product away by accident.
    expect(planFor("enterprise-gold").id).toBe("free");
    expect(can("enterprise-gold", "agent_workspace")).toBe(false);
  });
});

describe("prices", () => {
  it("stores every price in pennies as a bigint", () => {
    for (const plan of Object.values(PLANS)) {
      expect(typeof plan.monthly_pennies).toBe("bigint");
      if (plan.yearly_pennies !== null) expect(typeof plan.yearly_pennies).toBe("bigint");
    }
  });

  it("matches the prices in the spec", () => {
    expect(PLANS.landlord.monthly_pennies).toBe(600n);
    expect(PLANS.landlord.yearly_pennies).toBe(6000n);
    expect(PLANS.portfolio.monthly_pennies).toBe(1500n);
    expect(PLANS.agent.monthly_pennies).toBe(4900n);
    expect(PLANS.agent.overage_pennies_per_property).toBe(75n);
  });

  it("makes the yearly price cheaper than twelve months", () => {
    for (const plan of Object.values(PLANS)) {
      if (plan.yearly_pennies === null || plan.monthly_pennies === 0n) continue;
      expect(plan.yearly_pennies).toBeLessThan(plan.monthly_pennies * 12n);
    }
  });

  it("gives every paid plan a trial", () => {
    for (const plan of Object.values(PLANS)) {
      if (plan.monthly_pennies > 0n) expect(plan.trial_days).toBe(14);
    }
  });
});

describe("property limits", () => {
  it("allows a property within the limit", () => {
    expect(checkPropertyLimit("landlord", 3)).toEqual({ allowed: true, overage: 0, overagePennies: 0n });
  });

  it("stops a plan with no overage at its limit, and names the plan that covers it", () => {
    const result = checkPropertyLimit("landlord", 4);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.limit).toBe(3);
      expect(result.reason).toContain("Portfolio");
    }
  });

  it("prices overage rather than blocking on the agent plan", () => {
    const result = checkPropertyLimit("agent", 54);
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.overage).toBe(4);
      expect(result.overagePennies).toBe(300n);
    }
  });

  it("charges the agent plan its base price plus overage", () => {
    expect(monthlyCostPennies("agent", 50)).toBe(4900n);
    expect(monthlyCostPennies("agent", 54)).toBe(5200n);
    expect(monthlyCostPennies("landlord", 3)).toBe(600n);
  });

  it("suggests the cheapest plan that would cover the portfolio", () => {
    expect(nextPlanFor(3, "free")).toBe("landlord");
    expect(nextPlanFor(10, "free")).toBe("portfolio");
    expect(nextPlanFor(40, "landlord")).toBe("agent");
  });

  it("never suggests a plan the account is already on or above", () => {
    expect(nextPlanFor(2, "agent")).toBeNull();
  });
});

describe("Agent Attestation", () => {
  let client: Client;
  let landlord: Fixture;
  let agent: Fixture;
  let agentCtx: { accountId: string; userId: string };

  const change = {
    property_id: "",
    property_label: "12 Acacia Road, Birmingham",
    field: "rent_pennies",
    field_label: "Rent",
    old_value: "120000",
    new_value: "125000",
    sentence: "Your agent says the rent at 12 Acacia Road is now £1,250 a month from 1 March.",
  };

  beforeAll(async () => {
    await ensureTestSchema();
    client = await connect();
    landlord = await createAccount(client, "AttestLandlord");
    agent = await createAccount(client, "AttestAgent", "agent");
    await grantAgent(client, landlord, agent);
    agentCtx = { accountId: agent.accountId, userId: agent.userId };
    change.property_id = landlord.propertyId;
  }, 60_000);

  afterAll(async () => { await client?.end(); });

  it("stores only the hash of the link token", async () => {
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    await setContext(client, agentCtx);
    const { rows } = await client.query<{ token_hash: string }>(
      "select token_hash from live_attestation_requests order by created_at desc limit 1",
    );
    expect(rows[0]!.token_hash).not.toContain(token);
  });

  it("resolves for the landlord with no account, carrying the agent's name", async () => {
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    const lookup = await lookupAttestation(token);
    expect(lookup.ok).toBe(true);
    if (lookup.ok) {
      expect(lookup.agentName).toBe("AttestAgent");
      expect(lookup.change.sentence).toContain("£1,250");
    }
  });

  it("does not resolve a made-up token", async () => {
    expect((await lookupAttestation(newToken())).ok).toBe(false);
  });

  it("records a confirmation in BOTH ledgers", async () => {
    // The point of the feature: each party holds independent evidence.
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    expect(await answerAttestation(token, "confirmed", null)).toEqual({ ok: true });

    for (const fixture of [landlord, agent]) {
      await setContext(client, { accountId: fixture.accountId, userId: fixture.userId });
      const { rows } = await client.query<{ count: string }>(
        "select count(*) as count from ledger_events where account_id = $1 and event_type = 'attestation.confirmed'",
        [fixture.accountId],
      );
      expect(Number(rows[0]!.count), `${fixture.accountId} ledger`).toBeGreaterThan(0);
    }
  });

  it("records a dispute, with the landlord's note", async () => {
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    expect(await answerAttestation(token, "disputed", "We agreed £1,200.")).toEqual({ ok: true });

    await setContext(client, { accountId: landlord.accountId, userId: landlord.userId });
    const { rows } = await client.query<{ dispute_note: string; state: string }>(
      `select dispute_note, state::text as state from live_attestation_requests
        where state = 'disputed' order by responded_at desc limit 1`,
    );
    expect(rows[0]!.dispute_note).toBe("We agreed £1,200.");
  });

  it("refuses a second answer on the same link", async () => {
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    expect(await answerAttestation(token, "confirmed", null)).toEqual({ ok: true });
    const again = await answerAttestation(token, "disputed", null);
    expect(again.ok).toBe(false);
  });

  it("refuses an expired request", async () => {
    const { token } = await requestAttestation(agentCtx, landlord.accountId, change);
    await setContext(client, agentCtx);
    await client.query(
      "update attestation_requests set expires_at = now() - interval '1 day' where state = 'pending'",
    );
    const lookup = await lookupAttestation(token);
    expect(lookup.ok).toBe(false);
    if (!lookup.ok) expect(lookup.reason).toBe("expired");
  });

  it("leaves both ledger chains intact", async () => {
    for (const fixture of [landlord, agent]) {
      await setContext(client, { accountId: fixture.accountId, userId: fixture.userId });
      const { rows } = await client.query("select seq, problem from ledger_verify($1)", [fixture.accountId]);
      expect(rows, `${fixture.accountId} chain`).toEqual([]);
    }
  });
});
