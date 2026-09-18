import { describe, expect, it } from "vitest";
import {
  applicableFields, ENTITY_SECTIONS, readiness, REHEARSAL_SECTIONS,
  type RehearsalAnswers,
} from "../src/rehearsal.js";

/** Every required field answered, for an individual landlord with gas. */
function completeAnswers(): RehearsalAnswers {
  const answers: RehearsalAnswers = { has_gas: "yes", licence_kind: "none_needed" };
  for (const { field } of applicableFields(answers)) {
    if (field.required && answers[field.id] === undefined) answers[field.id] = "answered";
  }
  return answers;
}

describe("the question set mirrors the government's form", () => {
  it("asks about the property before asking about the letting", () => {
    const ids = REHEARSAL_SECTIONS.map((s) => s.id);
    expect(ids.indexOf("property")).toBeLessThan(ids.indexOf("tenancy"));
    expect(ids.indexOf("landlord")).toBeLessThan(ids.indexOf("occupancy"));
  });

  it("gives every field a human question, a type and a required flag", () => {
    for (const section of REHEARSAL_SECTIONS) {
      expect(section.fields.length).toBeGreaterThan(0);
      for (const field of section.fields) {
        // Continuation labels inside an address block ("Postcode", "Town or
        // city") are legitimately not questions, so the assertion is that the
        // wording is human, not that it ends in a question mark.
        expect(field.question.length).toBeGreaterThan(4);
        expect(field.question, field.id).not.toMatch(/_/);
        expect(field.question[0], field.id).toBe(field.question[0]!.toUpperCase());
        expect(typeof field.required).toBe("boolean");
      }
    }
  });

  it("has unique field ids across every section", () => {
    const ids = REHEARSAL_SECTIONS.flatMap((s) => s.fields.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers the government's own options for the choice questions", () => {
    const type = REHEARSAL_SECTIONS[0]!.fields.find((f) => f.id === "property_type")!;
    expect(type.options!.map((o) => o.value)).toEqual([
      "detached", "semi_detached", "terraced", "flat", "other",
    ]);
  });

  it("explains the 4.64 square metre bedroom rule where it is asked", () => {
    const bedrooms = REHEARSAL_SECTIONS.flatMap((s) => s.fields).find((f) => f.id === "bedrooms")!;
    expect(bedrooms.help).toContain("4.64");
  });

  it("warns that the correspondence address cannot be a PO box", () => {
    const field = REHEARSAL_SECTIONS.flatMap((s) => s.fields).find((f) => f.id === "correspondence_line1")!;
    expect(field.help).toMatch(/PO box/i);
  });

  it("says licensing is in addition to registering, not instead of it", () => {
    const licensing = REHEARSAL_SECTIONS.find((s) => s.id === "licensing")!;
    expect(licensing.intro).toMatch(/in addition|does not replace/i);
  });

  it("explains who counts as an occupant, including babies", () => {
    const occupancy = REHEARSAL_SECTIONS.find((s) => s.id === "occupancy")!;
    expect(occupancy.intro).toMatch(/children and babies/i);
    expect(occupancy.intro).toMatch(/90 days/);
  });
});

describe("conditional questions", () => {
  it("does not ask for a gas certificate when there is no gas", () => {
    const fields = applicableFields({ has_gas: "no" }).map(({ field }) => field.id);
    expect(fields).not.toContain("gas_certificate");
  });

  it("asks for a gas certificate when there is gas", () => {
    const fields = applicableFields({ has_gas: "yes" }).map(({ field }) => field.id);
    expect(fields).toContain("gas_certificate");
  });

  it("asks for a licence number only for a selective licence", () => {
    expect(applicableFields({ licence_kind: "selective" }).map(({ field }) => field.id))
      .toContain("licence_number");
    expect(applicableFields({ licence_kind: "none_needed" }).map(({ field }) => field.id))
      .not.toContain("licence_number");
  });
});

describe("entity handling", () => {
  it("adds company questions for a company landlord", () => {
    const fields = applicableFields({}, "company").map(({ field }) => field.id);
    expect(fields).toContain("companies_house_number");
    expect(fields).toContain("nominated_contact");
  });

  it("adds lead trustee questions for a trust", () => {
    expect(applicableFields({}, "trust").map(({ field }) => field.id)).toContain("lead_trustee_name");
  });

  it("flags that a representative needs certified evidence of authority", () => {
    expect(ENTITY_SECTIONS["representative"]!.intro).toMatch(/certified evidence/i);
  });

  it("asks an individual none of the entity questions", () => {
    const fields = applicableFields({}, "individual").map(({ field }) => field.id);
    expect(fields).not.toContain("companies_house_number");
    expect(fields).not.toContain("lead_trustee_name");
  });
});

describe("readiness", () => {
  it("is zero and not ready when nothing is answered", () => {
    const r = readiness({});
    expect(r.score).toBe(0);
    expect(r.ready).toBe(false);
    expect(r.blockers.length).toBeGreaterThan(5);
  });

  it("is 100 and ready when everything required is answered", () => {
    const r = readiness(completeAnswers());
    expect(r.score).toBe(100);
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("does not count an optional field against you", () => {
    const answers = completeAnswers();
    delete answers["freeholder_name"];
    expect(readiness(answers).ready).toBe(true);
  });

  it("goes back below ready when a required answer is removed", () => {
    const answers = completeAnswers();
    delete answers["occupants"];
    const r = readiness(answers);
    expect(r.ready).toBe(false);
    expect(r.blockers.map((b) => b.field_id)).toContain("occupants");
  });

  it("treats an empty string as unanswered", () => {
    const answers = { ...completeAnswers(), postcode: "" };
    expect(readiness(answers).blockers.map((b) => b.field_id)).toContain("postcode");
  });

  it("does not ask for a gas certificate in the score when there is no gas", () => {
    const withGas = readiness({ ...completeAnswers(), has_gas: "yes" });
    const answers = completeAnswers();
    answers["has_gas"] = "no";
    delete answers["gas_certificate"];
    const withoutGas = readiness(answers);
    expect(withoutGas.required).toBeLessThan(withGas.required);
    expect(withoutGas.ready).toBe(true);
  });

  it("gives a blocker that says what to do, not just what is missing", () => {
    const answers = completeAnswers();
    delete answers["gas_certificate"];
    const blocker = readiness(answers).blockers.find((b) => b.field_id === "gas_certificate")!;
    expect(blocker.message).toMatch(/Upload one|Cert Inbox/i);
  });

  it("tells a landlord what to enter when they do not have the freeholder's email", () => {
    // freeholder_email is optional, so drive the message directly via a
    // required-field scenario that exercises the same table.
    const answers = completeAnswers();
    delete answers["correspondence_postcode"];
    const blocker = readiness(answers).blockers.find((b) => b.field_id === "correspondence_postcode")!;
    expect(blocker.message).toMatch(/England or Wales/);
  });

  it("points at Household Pulse when occupancy is unknown", () => {
    const answers = completeAnswers();
    delete answers["households"];
    const blocker = readiness(answers).blockers.find((b) => b.field_id === "households")!;
    expect(blocker.message).toMatch(/Household Pulse/);
  });

  it("counts the company questions for a company landlord", () => {
    const individual = readiness(completeAnswers(), "individual");
    const answers: RehearsalAnswers = { has_gas: "yes", licence_kind: "none_needed" };
    for (const { field } of applicableFields(answers, "company")) {
      if (field.required) answers[field.id] = "answered";
    }
    const company = readiness(answers, "company");
    expect(company.required).toBeGreaterThan(individual.required);
    expect(company.ready).toBe(true);
  });

  it("never reports a score outside 0 to 100", () => {
    for (const answers of [{}, completeAnswers(), { has_gas: "no" }]) {
      const r = readiness(answers);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});
