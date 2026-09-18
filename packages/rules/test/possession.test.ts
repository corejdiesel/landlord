import { describe, expect, it } from "vitest";
import { evaluate } from "../src/engine.js";
import { possessionReadiness, POSSESSION_CAVEAT } from "../src/possession.js";
import { SEED_RULES } from "../src/data/rules.js";
import { aDocument, anInput, aProperty, aRegistration, aTenancy, compliantScenario } from "./fixtures.js";
import { aLandlord } from "./fixtures.js";

function readiness(input = anInput(), deadlinePassed = true) {
  return possessionReadiness(input, evaluate(input, SEED_RULES), {
    registrationDeadlinePassed: deadlinePassed,
  });
}

const check = (r: ReturnType<typeof readiness>, id: string) => r.checks.find((c) => c.id === id)!;

describe("the caveat", () => {
  it("is present, fixed, and says this is not advice", () => {
    expect(readiness().caveat).toBe(POSSESSION_CAVEAT);
    expect(POSSESSION_CAVEAT).toMatch(/not legal advice/i);
  });

  it("calls out that Grounds 7A and 14 are treated differently", () => {
    expect(POSSESSION_CAVEAT).toMatch(/7A and 14/);
  });

  it("points at a solicitor rather than at a next step", () => {
    expect(POSSESSION_CAVEAT).toMatch(/solicitor/i);
  });
});

describe("it never strays into advice", () => {
  const scenarios = [
    readiness(anInput()),
    readiness(compliantScenario()),
    readiness(anInput({ registration: aRegistration({ status: "active", property_registration_number: "P1" }) })),
    readiness(anInput(), false),
  ];

  it("never mentions a notice, a ground, a section or a court step", () => {
    for (const r of scenarios) {
      for (const c of r.checks) {
        const text = `${c.label} ${c.detail}`;
        expect(text, c.id).not.toMatch(/section 8|section 21|notice period|serve notice|court|evict|ground \d/i);
      }
    }
  });

  it("describes what is missing rather than instructing", () => {
    for (const r of scenarios) {
      for (const c of r.checks) {
        expect(c.detail, c.id).not.toMatch(/you should|you must now|we recommend/i);
      }
    }
  });

  it("gives every check a rule id, so the provenance is visible", () => {
    for (const r of scenarios) {
      for (const c of r.checks) expect(c.rule_ids.length).toBeGreaterThan(0);
    }
  });
});

describe("registration", () => {
  it("is not applicable before the region's deadline", () => {
    const r = readiness(anInput(), false);
    expect(check(r, "registration").state).toBe("not_applicable");
    expect(check(r, "registration").detail).toMatch(/deadline has not passed/);
  });

  it("is red once the deadline has passed and nothing is registered", () => {
    expect(check(readiness(anInput(), true), "registration").state).toBe("red");
  });

  it("is green when both entries are active", () => {
    const r = readiness(anInput({
      landlord: aLandlord({ landlord_registration_number: "LRN-1", registered_on: "2027-01-01" }),
      registration: aRegistration({ status: "active", property_registration_number: "PRP-1" }),
    }));
    expect(check(r, "registration").state).toBe("green");
  });

  it("distinguishes a missing landlord entry from a missing property entry", () => {
    const missingLandlord = readiness(anInput({
      registration: aRegistration({ status: "active", property_registration_number: "PRP-1" }),
    }));
    expect(check(missingLandlord, "registration").detail).toMatch(/own landlord entry is not recorded/);

    const missingProperty = readiness(anInput({
      landlord: aLandlord({ landlord_registration_number: "LRN-1" }),
    }));
    expect(check(missingProperty, "registration").detail).toMatch(/property's entry is not active/);
  });
});

describe("deposit", () => {
  it("is green when protected and the information was served", () => {
    expect(check(readiness(), "deposit").state).toBe("green");
  });

  it("is red when the prescribed information is missing, even though it is protected", () => {
    const r = readiness(anInput({ tenancy: aTenancy({ prescribed_information_served_on: null }) }));
    expect(check(r, "deposit").state).toBe("red");
    expect(check(r, "deposit").detail).toMatch(/prescribed information/);
  });

  it("is not applicable when no deposit was taken", () => {
    const r = readiness(anInput({ tenancy: aTenancy({ deposit_taken: false }) }));
    expect(check(r, "deposit").state).toBe("not_applicable");
  });
});

describe("certificates", () => {
  it("is amber when a certificate is in date but not recorded as served", () => {
    // Holding it is not the duty; giving it to the tenant is the part people miss.
    const r = readiness(anInput({
      documents: [aDocument({ id: "g", kind: "gas_safety_record", expires_on: "2027-06-01", served_on_tenant_at: null })],
    }));
    expect(check(r, "gas").state).toBe("amber");
    expect(check(r, "gas").detail).toMatch(/no record of it being given/);
  });

  it("is green when in date and served", () => {
    const r = readiness(anInput({
      documents: [aDocument({ id: "g", kind: "gas_safety_record", expires_on: "2027-06-01", served_on_tenant_at: "2026-06-05" })],
    }));
    expect(check(r, "gas").state).toBe("green");
  });

  it("is red when nothing is on file", () => {
    expect(check(readiness(), "gas").state).toBe("red");
  });

  it("is red when what we hold has expired", () => {
    const r = readiness(anInput({
      today: "2027-07-01",
      documents: [aDocument({ id: "g", kind: "gas_safety_record", expires_on: "2027-06-01", served_on_tenant_at: "2026-06-05" })],
    }));
    expect(check(r, "gas").state).toBe("red");
  });

  it("is not applicable for gas at a property with none", () => {
    const r = readiness(anInput({ property: aProperty({ has_gas: false }) }));
    expect(check(r, "gas").state).toBe("not_applicable");
  });
});

describe("overall rating", () => {
  it("is red if anything is red", () => {
    expect(readiness().overall).toBe("red");
  });

  it("is amber when the worst thing is amber", () => {
    const r = readiness(anInput({
      landlord: aLandlord({ landlord_registration_number: "LRN-1" }),
      registration: aRegistration({ status: "active", property_registration_number: "P1" }),
      documents: [
        aDocument({ id: "g", kind: "gas_safety_record", expires_on: "2027-06-01", served_on_tenant_at: null }),
        aDocument({ id: "e", kind: "eicr", issued_on: "2024-01-01", expires_on: "2029-01-01", served_on_tenant_at: "2024-01-05" }),
        aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "C", served_on_tenant_at: "2024-01-05" }),
      ],
    }));
    expect(check(r, "gas").state).toBe("amber");
    expect(r.overall).toBe("amber");
  });

  it("is green only when everything applicable is green", () => {
    const r = readiness(anInput({
      landlord: aLandlord({ landlord_registration_number: "LRN-1" }),
      registration: aRegistration({ status: "active", property_registration_number: "P1" }),
      documents: [
        aDocument({ id: "g", kind: "gas_safety_record", expires_on: "2027-06-01", served_on_tenant_at: "2026-06-05" }),
        aDocument({ id: "e", kind: "eicr", issued_on: "2024-01-01", expires_on: "2029-01-01", served_on_tenant_at: "2024-01-05" }),
        aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "C", served_on_tenant_at: "2024-01-05" }),
      ],
    }));
    expect(r.overall).toBe("green");
  });

  it("ignores not-applicable checks when deciding the overall rating", () => {
    const r = readiness(anInput({
      property: aProperty({ has_gas: false }),
      landlord: aLandlord({ landlord_registration_number: "LRN-1" }),
      registration: aRegistration({ status: "active", property_registration_number: "P1" }),
      tenancy: aTenancy({ deposit_taken: false }),
      documents: [
        aDocument({ id: "e", kind: "eicr", issued_on: "2024-01-01", expires_on: "2029-01-01", served_on_tenant_at: "2024-01-05" }),
        aDocument({ id: "p", kind: "epc", expires_on: "2030-01-01", epc_rating: "C", served_on_tenant_at: "2024-01-05" }),
      ],
    }));
    expect(r.overall).toBe("green");
  });
});
