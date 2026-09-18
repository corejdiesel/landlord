import { describe, expect, it } from "vitest";
import { evaluate, exposurePennies, nextBestAction, resolveEffectiveFrom, sortByUrgency } from "../src/engine.js";
import { ALL_RULES, SEED_RULES, ruleById } from "../src/data/rules.js";
import { buildFactBag, evaluatePredicate, factsReferenced, UnknownFactError } from "../src/predicate.js";
import type { Obligation, Rule } from "../src/types.js";
import { aDocument, anInput, aProperty, aRegistration, aTenancy, compliantScenario } from "./fixtures.js";

const find = (obs: Obligation[], id: string) => obs.find((o) => o.rule_id === id);

describe("rule corpus integrity", () => {
  it("has unique rule ids", () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never marks a seed rule verified_primary (that promotion is a human job)", () => {
    for (const rule of ALL_RULES) {
      expect(rule.verification_status).not.toBe("verified_primary");
    }
  });

  it("gives every rule at least one source with a checked_on date", () => {
    for (const rule of ALL_RULES) {
      expect(rule.sources.length).toBeGreaterThan(0);
      for (const s of rule.sources) {
        expect(s.url).toMatch(/^https:\/\//);
        expect(s.checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("keeps titles and summaries within the lengths the UI is designed for", () => {
    for (const rule of ALL_RULES) {
      expect(rule.title.length, `${rule.id} title`).toBeLessThanOrEqual(60);
      expect(rule.summary.length, `${rule.id} summary`).toBeLessThanOrEqual(240);
    }
  });

  it("only references facts the engine actually exposes", () => {
    const bag = buildFactBag(anInput());
    for (const rule of ALL_RULES) {
      for (const fact of factsReferenced(rule.applies_when)) {
        expect(Object.keys(bag), `${rule.id} -> ${fact}`).toContain(fact);
      }
    }
  });

  it("marks every Renters' Rights Act phase 1 rule unverified pending legal review", () => {
    const rraIds = ALL_RULES.filter((r) => r.id.startsWith("RRA-"));
    expect(rraIds.length).toBeGreaterThan(0);
    for (const rule of rraIds) expect(rule.verification_status).toBe("unverified");
  });

  it("creates no obligations from not_commenced or proposed rules", () => {
    const inert = ALL_RULES.filter((r) => r.status === "not_commenced" || r.status === "proposed");
    expect(inert.length).toBeGreaterThan(0);
    for (const rule of inert) {
      expect(rule.applies_when).toEqual({ op: "never" });
    }
  });
});

describe("predicate evaluation", () => {
  const bag = buildFactBag(anInput());

  it("handles the boolean combinators", () => {
    expect(evaluatePredicate({ op: "always" }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "never" }, bag)).toBe(false);
    expect(evaluatePredicate({ op: "not", of: { op: "never" } }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "and", of: [{ op: "always" }, { op: "never" }] }, bag)).toBe(false);
    expect(evaluatePredicate({ op: "or", of: [{ op: "always" }, { op: "never" }] }, bag)).toBe(true);
  });

  it("compares equality and membership", () => {
    expect(evaluatePredicate({ op: "eq", fact: "property.has_gas", value: true }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "neq", fact: "property.has_gas", value: false }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "in", fact: "tenancy.kind", values: ["assured", "rent_act_regulated"] }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "in", fact: "tenancy.kind", values: ["lodger"] }, bag)).toBe(false);
  });

  it("compares numbers and refuses to coerce non-numbers", () => {
    expect(evaluatePredicate({ op: "gt", fact: "property.bedrooms", value: 2 }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "gte", fact: "property.bedrooms", value: 3 }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "lt", fact: "property.bedrooms", value: 3 }, bag)).toBe(false);
    expect(evaluatePredicate({ op: "lte", fact: "property.bedrooms", value: 3 }, bag)).toBe(true);
    // A boolean fact must not sneak through a numeric comparison as 1.
    expect(evaluatePredicate({ op: "gt", fact: "property.has_gas", value: 0 }, bag)).toBe(false);
  });

  it("treats exists as present-and-not-false", () => {
    expect(evaluatePredicate({ op: "exists", fact: "tenancy.exists" }, bag)).toBe(true);
    expect(evaluatePredicate({ op: "exists", fact: "documents.gas.exists" }, bag)).toBe(false);
  });

  it("throws loudly on a typo in a rule definition rather than silently not applying", () => {
    expect(() => evaluatePredicate({ op: "eq", fact: "property.has_gass", value: true }, bag, "TEST-RULE"))
      .toThrow(UnknownFactError);
  });
});

describe("regional effective dates", () => {
  it("resolves the PRS registration deadline from the property's region", () => {
    const rule = ruleById("PRS-REG-DWELLING")!;
    const wm = resolveEffectiveFrom(rule, anInput({ property: aProperty({ itl1_region: "west_midlands" }) }));
    const london = resolveEffectiveFrom(rule, anInput({ property: aProperty({ itl1_region: "london" }) }));
    expect(wm).toBe("2027-03-14");
    expect(london).toBe("2027-10-14");
  });

  it("resolves the 28-day update duty from the commencement date, not the deadline", () => {
    const rule = ruleById("PRS-UPDATE-28D")!;
    expect(resolveEffectiveFrom(rule, anInput({ property: aProperty({ itl1_region: "london" }) })))
      .toBe("2027-07-15");
  });

  it("uses the fixed date for rules that have one", () => {
    const rule = ruleById("GAS-ANNUAL")!;
    expect(resolveEffectiveFrom(rule, anInput())).toBe("1998-10-31");
  });
});

describe("PRS scope", () => {
  it("applies to an assured tenancy", () => {
    const obs = evaluate(anInput(), SEED_RULES);
    expect(find(obs, "PRS-REG-DWELLING")).toBeDefined();
  });

  it.each(["lodger", "high_rent", "low_rent", "supported_exempt"] as const)(
    "does not apply to a %s arrangement",
    (kind) => {
      const obs = evaluate(anInput({ tenancy: aTenancy({ kind }) }), SEED_RULES);
      expect(find(obs, "PRS-REG-DWELLING")).toBeUndefined();
      expect(find(obs, "PRS-REG-LANDLORD")).toBeUndefined();
    },
  );

  it("applies to a Rent Act regulated tenancy", () => {
    const obs = evaluate(anInput({ tenancy: aTenancy({ kind: "rent_act_regulated" }) }), SEED_RULES);
    expect(find(obs, "PRS-REG-DWELLING")).toBeDefined();
  });

  it("does not apply when the property is not let", () => {
    const obs = evaluate(
      anInput({ property: aProperty({ is_let: false }), tenancy: null }),
      SEED_RULES,
    );
    expect(find(obs, "PRS-REG-DWELLING")).toBeUndefined();
    expect(find(obs, "GAS-ANNUAL")).toBeUndefined();
  });
});

describe("registration obligation states", () => {
  it("is not yet applicable before the region's deadline", () => {
    const obs = evaluate(anInput({ today: "2026-09-18" }), SEED_RULES);
    expect(find(obs, "PRS-REG-DWELLING")!.state).toBe("not_yet_applicable");
  });

  it("becomes due_soon inside the 30-day run-up", () => {
    const obs = evaluate(anInput({ today: "2027-03-01" }), SEED_RULES);
    const o = find(obs, "PRS-REG-DWELLING")!;
    expect(o.state).toBe("due_soon");
    expect(o.days_remaining).toBe(13);
  });

  it("is still in time on the deadline day itself", () => {
    const obs = evaluate(anInput({ today: "2027-03-14" }), SEED_RULES);
    const o = find(obs, "PRS-REG-DWELLING")!;
    expect(o.days_remaining).toBe(0);
    expect(o.state).toBe("due_soon");
  });

  it("is overdue the day after the deadline", () => {
    const obs = evaluate(anInput({ today: "2027-03-15" }), SEED_RULES);
    const o = find(obs, "PRS-REG-DWELLING")!;
    expect(o.state).toBe("overdue");
    expect(o.days_remaining).toBe(-1);
  });

  it("is satisfied once an active entry is recorded", () => {
    const obs = evaluate(
      anInput({
        today: "2027-03-15",
        registration: aRegistration({
          property_registration_number: "PRP-123",
          registered_on: "2027-02-01",
          status: "active",
        }),
      }),
      SEED_RULES,
    );
    const o = find(obs, "PRS-REG-DWELLING")!;
    expect(o.state).toBe("satisfied");
    expect(o.satisfied_by).toBe("PRP-123");
  });

  it("reopens when the entry lapses", () => {
    const obs = evaluate(
      anInput({ today: "2027-03-15", registration: aRegistration({ status: "lapsed" }) }),
      SEED_RULES,
    );
    expect(find(obs, "PRS-REG-DWELLING")!.state).toBe("overdue");
  });
});

describe("gas safety", () => {
  it("is satisfied by an in-date record", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "gas-1", expires_on: "2027-06-01" })] }),
      SEED_RULES,
    );
    const o = find(obs, "GAS-ANNUAL")!;
    expect(o.state).toBe("satisfied");
    expect(o.satisfied_by).toBe("gas-1");
  });

  it("goes overdue once the record expires", () => {
    const obs = evaluate(
      anInput({ today: "2027-06-02", documents: [aDocument({ id: "gas-1", expires_on: "2027-06-01" })] }),
      SEED_RULES,
    );
    expect(find(obs, "GAS-ANNUAL")!.state).toBe("overdue");
  });

  it("falls back to 12 months from issue when the record states no expiry", () => {
    const obs = evaluate(
      anInput({ today: "2027-01-01", documents: [aDocument({ id: "g", issued_on: "2026-06-01", expires_on: null })] }),
      SEED_RULES,
    );
    expect(find(obs, "GAS-ANNUAL")!.due_on).toBe("2027-06-01");
  });

  it("ignores an unconfirmed extraction — nothing counts until the landlord confirms it", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "gas-1", confirmed_at: null })] }),
      SEED_RULES,
    );
    const o = find(obs, "GAS-ANNUAL")!;
    expect(o.state).toBe("overdue");
    expect(o.reason).toContain("No gas safety record");
  });

  it("uses the most recent record when several are on file", () => {
    const obs = evaluate(
      anInput({
        documents: [
          aDocument({ id: "old", issued_on: "2025-06-01", expires_on: "2026-06-01" }),
          aDocument({ id: "new", issued_on: "2026-06-01", expires_on: "2027-06-01" }),
        ],
      }),
      SEED_RULES,
    );
    expect(find(obs, "GAS-ANNUAL")!.satisfied_by).toBe("new");
  });

  it("does not apply to a property with no gas", () => {
    const obs = evaluate(anInput({ property: aProperty({ has_gas: false }) }), SEED_RULES);
    expect(find(obs, "GAS-ANNUAL")).toBeUndefined();
    expect(find(obs, "PRS-GAS-UPLOAD")).toBeUndefined();
  });
});

describe("electrical safety", () => {
  it("is satisfied by an in-date satisfactory report", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "e", kind: "eicr", issued_on: "2024-03-01", expires_on: "2029-03-01" })] }),
      SEED_RULES,
    );
    expect(find(obs, "ELEC-5Y")!.state).toBe("satisfied");
  });

  it("honours an earlier re-inspection date stated on the report over the 5-year maximum", () => {
    const obs = evaluate(
      anInput({
        today: "2026-09-18",
        documents: [aDocument({ id: "e", kind: "eicr", issued_on: "2025-01-01", expires_on: "2026-01-01" })],
      }),
      SEED_RULES,
    );
    expect(find(obs, "ELEC-5Y")!.state).toBe("overdue");
  });

  it("opens a 28-day remedial obligation on an unsatisfactory report", () => {
    const obs = evaluate(
      anInput({
        today: "2026-09-18",
        documents: [aDocument({
          id: "e", kind: "eicr", issued_on: "2026-09-10", expires_on: "2031-09-10", outcome: "unsatisfactory",
        })],
      }),
      SEED_RULES,
    );
    const o = find(obs, "ELEC-REMEDIAL-28D")!;
    expect(o.due_on).toBe("2026-10-08");
    expect(o.state).toBe("due_soon");
  });

  it("does not open remedial work when the report is satisfactory", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "e", kind: "eicr", outcome: "satisfactory" })] }),
      SEED_RULES,
    );
    expect(find(obs, "ELEC-REMEDIAL-28D")).toBeUndefined();
  });
});

describe("EPC", () => {
  it("is satisfied by an in-date C rating", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "C" })] }),
      SEED_RULES,
    );
    expect(find(obs, "EPC-VALID")!.state).toBe("satisfied");
  });

  it("flags a rating below the minimum of E", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "F" })] }),
      SEED_RULES,
    );
    const o = find(obs, "EPC-VALID")!;
    expect(o.state).not.toBe("satisfied");
    expect(o.reason).toContain("below the minimum");
  });

  it("accepts E itself as the boundary", () => {
    const obs = evaluate(
      anInput({ documents: [aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "E" })] }),
      SEED_RULES,
    );
    expect(find(obs, "EPC-VALID")!.state).toBe("satisfied");
  });
});

describe("deposit protection", () => {
  it("is satisfied when protected and prescribed information served", () => {
    const obs = evaluate(anInput(), SEED_RULES);
    expect(find(obs, "DEPOSIT-30D")!.state).toBe("satisfied");
  });

  it("is not satisfied when the prescribed information is missing, even if protected", () => {
    const obs = evaluate(
      anInput({ tenancy: aTenancy({ prescribed_information_served_on: null }) }),
      SEED_RULES,
    );
    const o = find(obs, "DEPOSIT-30D")!;
    expect(o.state).toBe("overdue");
    expect(o.reason).toContain("prescribed information");
  });

  it("computes the 30-day window from the tenancy start", () => {
    const obs = evaluate(
      anInput({ tenancy: aTenancy({ started_on: "2026-09-01", deposit_protected_on: null, prescribed_information_served_on: null }) }),
      SEED_RULES,
    );
    expect(find(obs, "DEPOSIT-30D")!.due_on).toBe("2026-10-01");
  });

  it("does not apply when no deposit was taken", () => {
    const obs = evaluate(anInput({ tenancy: aTenancy({ deposit_taken: false }) }), SEED_RULES);
    expect(find(obs, "DEPOSIT-30D")).toBeUndefined();
  });
});

describe("licensing", () => {
  it("does not apply when no licence is needed", () => {
    const obs = evaluate(anInput(), SEED_RULES);
    expect(find(obs, "LICENSING")).toBeUndefined();
  });

  it("goes overdue on an expired selective licence", () => {
    const obs = evaluate(
      anInput({ property: aProperty({ licence_kind: "selective", licence_expires_on: "2026-01-01" }) }),
      SEED_RULES,
    );
    expect(find(obs, "LICENSING")!.state).toBe("overdue");
  });

  it("flags a needed licence that is not recorded at all", () => {
    const obs = evaluate(
      anInput({ property: aProperty({ licence_kind: "hmo_mandatory", licence_expires_on: null }) }),
      SEED_RULES,
    );
    expect(find(obs, "LICENSING")!.reason).toContain("none is recorded");
  });
});

describe("unverified rules are hidden from users by default", () => {
  it("excludes them unless explicitly asked for", () => {
    const withoutUnverified = evaluate(anInput(), ALL_RULES);
    const withUnverified = evaluate(anInput(), ALL_RULES, { includeUnverified: true });
    expect(withoutUnverified.some((o) => o.rule_id.startsWith("RRA-"))).toBe(false);
    expect(withUnverified.some((o) => o.rule_id.startsWith("RRA-"))).toBe(true);
  });

  it("marks every returned obligation with its verification status so the UI can show it", () => {
    for (const o of evaluate(anInput(), ALL_RULES, { includeUnverified: true })) {
      expect(["verified_primary", "verified_secondary", "unverified"]).toContain(o.verification_status);
      expect(o.sources.length).toBeGreaterThan(0);
    }
  });
});

describe("ordering and summaries", () => {
  it("puts overdue first, then due soon, then upcoming, then satisfied", () => {
    const sorted = sortByUrgency([
      { state: "satisfied", rule_id: "a", due_on: null } as Obligation,
      { state: "overdue", rule_id: "b", due_on: "2026-01-01" } as Obligation,
      { state: "upcoming", rule_id: "c", due_on: "2027-01-01" } as Obligation,
      { state: "due_soon", rule_id: "d", due_on: "2026-10-01" } as Obligation,
    ]);
    expect(sorted.map((o) => o.rule_id)).toEqual(["b", "d", "c", "a"]);
  });

  it("picks a next best action that is not already satisfied", () => {
    const obs = evaluate(anInput({ today: "2027-03-15" }), SEED_RULES);
    const next = nextBestAction(obs)!;
    expect(next.state).not.toBe("satisfied");
    expect(next.state).not.toBe("not_yet_applicable");
  });

  it("returns no action when everything is in order", () => {
    const allSatisfied: Obligation[] = [{ state: "satisfied", rule_id: "a", due_on: null } as Obligation];
    expect(nextBestAction(allSatisfied)).toBeNull();
  });

  it("sums exposure only from breached rules that carry a sourced figure", () => {
    const obs: Obligation[] = [
      { state: "overdue", consequence_pennies_max: 700000n } as Obligation,
      { state: "overdue", consequence_pennies_max: 700000n } as Obligation,
      { state: "due_soon", consequence_pennies_max: 700000n } as Obligation,
      { state: "overdue" } as Obligation,
    ];
    expect(exposurePennies(obs)).toBe(1400000n);
  });

  it("reports zero exposure for a compliant landlord", () => {
    const obs = evaluate(compliantScenario(), SEED_RULES);
    expect(exposurePennies(obs)).toBe(0n);
  });
});

describe("the compliant baseline", () => {
  it("raises nothing overdue", () => {
    const obs = evaluate(compliantScenario(), SEED_RULES);
    const overdue = obs.filter((o) => o.state === "overdue");
    expect(overdue.map((o) => o.rule_id)).toEqual([]);
  });

  it("gives every obligation a human-readable reason", () => {
    for (const o of evaluate(compliantScenario(), SEED_RULES)) {
      expect(o.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("engine purity", () => {
  it("returns the same answer for the same input", () => {
    const input = anInput();
    expect(evaluate(input, SEED_RULES)).toEqual(evaluate(input, SEED_RULES));
  });

  it("does not mutate its input", () => {
    const input = anInput({ documents: [aDocument()] });
    const snapshot = JSON.stringify(input, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    evaluate(input, ALL_RULES, { includeUnverified: true });
    expect(JSON.stringify(input, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(snapshot);
  });

  it("never reads the system clock", () => {
    const farFuture = evaluate(anInput({ today: "2030-01-01" }), SEED_RULES);
    const today = evaluate(anInput({ today: "2026-09-18" }), SEED_RULES);
    expect(farFuture).not.toEqual(today);
    expect(find(farFuture, "PRS-REG-DWELLING")!.state).toBe("overdue");
  });
});

describe("informational rules never become obligations", () => {
  it.each(["PRS-PENALTIES", "PRS-POSSESSION-BAR", "PRS-MARKETING-IDS", "LEGIONELLA", "ICO-FEE"])(
    "%s stays out of the obligation list",
    (id) => {
      const obs = evaluate(anInput(), ALL_RULES, { includeUnverified: true });
      expect(find(obs, id)).toBeUndefined();
    },
  );

  it("still keeps them in the corpus so the UI can explain them", () => {
    for (const id of ["PRS-PENALTIES", "PRS-MARKETING-IDS"]) {
      const rule = ruleById(id) as Rule;
      expect(rule).toBeDefined();
      expect(rule.informational).toBe(true);
    }
  });
});
