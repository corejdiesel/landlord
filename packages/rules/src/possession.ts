import { formatUkLong } from "./dates.js";
import type { EvaluationInput, Obligation } from "./types.js";

/**
 * Possession Readiness.
 *
 * Answers one question: "if I needed to seek possession tomorrow, is there
 * anything on my side that would block or weaken it?"
 *
 * This is a CHECKLIST, not advice, and the distinction is not decorative — the
 * moment it reads as advice we are a law firm without insurance. So:
 *  - every item says what is missing and where that comes from, never what to do
 *  - nothing here mentions a ground, a notice period, or a procedure
 *  - Grounds 7A and 14 are called out as treated differently, because the
 *    registration bar does not apply to them
 */

export type PossessionCheck = {
  id: string;
  label: string;
  state: "green" | "amber" | "red" | "not_applicable";
  detail: string;
  /** Rule IDs this check draws on, so the user can see the provenance. */
  rule_ids: string[];
};

export type PossessionReadiness = {
  overall: "green" | "amber" | "red";
  checks: PossessionCheck[];
  /** Fixed, prominent, and never varied. */
  caveat: string;
};

export const POSSESSION_CAVEAT =
  "This is a checklist of things on your side of the file, not legal advice and not " +
  "a view on whether you could obtain possession. Grounds 7A and 14 are treated " +
  "differently from the rest. Talk to a solicitor before taking any step.";

/**
 * Build the checklist from the same facts and obligations the rest of the
 * product uses, so it can never disagree with the dashboard.
 */
export function possessionReadiness(
  input: EvaluationInput,
  obligations: Obligation[],
  options: { registrationDeadlinePassed: boolean },
): PossessionReadiness {
  const checks: PossessionCheck[] = [];
  const by = (id: string) => obligations.find((o) => o.rule_id === id);

  // Registration. Only bites once the region's deadline has passed.
  const landlordEntry = input.landlord.landlord_registration_number !== null;
  const dwellingEntry = input.registration.status === "active";

  if (!options.registrationDeadlinePassed) {
    checks.push({
      id: "registration",
      label: "Registered on the database",
      state: "not_applicable",
      detail: "Your region's deadline has not passed yet, so this does not affect possession today.",
      rule_ids: ["PRS-REG-LANDLORD", "PRS-REG-DWELLING", "PRS-POSSESSION-BAR"],
    });
  } else if (landlordEntry && dwellingEntry) {
    checks.push({
      id: "registration",
      label: "Registered on the database",
      state: "green",
      detail: "Both your landlord entry and this property's entry are active.",
      rule_ids: ["PRS-REG-LANDLORD", "PRS-REG-DWELLING"],
    });
  } else {
    checks.push({
      id: "registration",
      label: "Registered on the database",
      state: "red",
      detail: !landlordEntry && !dwellingEntry
        ? "Neither your landlord entry nor this property's entry is recorded as active."
        : !landlordEntry
          ? "This property is registered, but your own landlord entry is not recorded."
          : "Your landlord entry is recorded, but this property's entry is not active.",
      rule_ids: ["PRS-REG-LANDLORD", "PRS-REG-DWELLING", "PRS-POSSESSION-BAR"],
    });
  }

  // Deposit.
  const tenancy = input.tenancy;
  if (!tenancy || !tenancy.deposit_taken) {
    checks.push({
      id: "deposit",
      label: "Deposit protected and information served",
      state: "not_applicable",
      detail: tenancy ? "No deposit was taken." : "No current tenancy recorded.",
      rule_ids: ["DEPOSIT-30D"],
    });
  } else {
    const protectedOn = tenancy.deposit_protected_on;
    const infoOn = tenancy.prescribed_information_served_on;
    checks.push({
      id: "deposit",
      label: "Deposit protected and information served",
      state: protectedOn && infoOn ? "green" : "red",
      detail: protectedOn && infoOn
        ? `Protected on ${formatUkLong(protectedOn)} and the prescribed information served.`
        : !protectedOn
          ? "No record that the deposit was protected in a scheme."
          : "The deposit is protected, but the prescribed information is not recorded as served.",
      rule_ids: ["DEPOSIT-30D"],
    });
  }

  // Certificates held AND served. Serving is the part people miss.
  for (const [id, label, ruleId, kinds] of [
    ["gas", "Gas safety record served on the tenant", "GAS-ANNUAL", ["gas_safety_record"]],
    ["electrical", "Electrical report served on the tenant", "ELEC-5Y", ["eicr", "eic"]],
    ["epc", "EPC served on the tenant", "EPC-VALID", ["epc"]],
  ] as const) {
    if (id === "gas" && !input.property.has_gas) {
      checks.push({
        id, label, state: "not_applicable",
        detail: "This property has no gas supply or appliances.",
        rule_ids: [ruleId],
      });
      continue;
    }

    const doc = input.documents
      .filter((d) => (kinds as readonly string[]).includes(d.kind) && d.confirmed_at !== null)
      .sort((a, b) => (a.issued_on ?? "").localeCompare(b.issued_on ?? ""))
      .at(-1);

    const obligation = by(ruleId);
    const held = obligation?.state === "satisfied";
    const served = doc?.served_on_tenant_at != null;

    checks.push({
      id, label,
      state: held && served ? "green" : held ? "amber" : "red",
      detail: !doc
        ? "Nothing on file."
        : !held
          ? "What we hold is out of date."
          : !served
            ? "In date, but we have no record of it being given to the tenant."
            : `Given to the tenant on ${formatUkLong(doc.served_on_tenant_at!)}.`,
      rule_ids: [ruleId],
    });
  }

  // Licensing.
  const licensing = by("LICENSING");
  checks.push({
    id: "licence",
    label: "Licence held where the council requires one",
    state: input.property.licence_kind === "none_needed"
      ? "not_applicable"
      : licensing?.state === "satisfied" ? "green" : "red",
    detail: input.property.licence_kind === "none_needed"
      ? "You have told us no licence is needed here."
      : licensing?.reason ?? "No licence recorded.",
    rule_ids: ["LICENSING"],
  });

  const relevant = checks.filter((c) => c.state !== "not_applicable");
  const overall: PossessionReadiness["overall"] =
    relevant.some((c) => c.state === "red") ? "red"
    : relevant.some((c) => c.state === "amber") ? "amber"
    : "green";

  return { overall, checks, caveat: POSSESSION_CAVEAT };
}
