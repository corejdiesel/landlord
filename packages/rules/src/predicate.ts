import type { EvaluationInput, FactPath, FactValue, Predicate } from "./types.js";

/**
 * Flatten an evaluation input into the dotted fact bag predicates read.
 *
 * Keeping this explicit (rather than walking the object generically) means a
 * rule can only reference facts we have deliberately exposed, so a typo in a
 * rule definition fails loudly in tests instead of silently reading undefined.
 */
export function buildFactBag(input: EvaluationInput): Record<FactPath, FactValue> {
  const { property, tenancy, documents, registration, landlord } = input;

  const latest = (kind: string) =>
    documents
      .filter((d) => d.kind === kind && d.confirmed_at !== null)
      .sort((a, b) => (a.issued_on ?? "").localeCompare(b.issued_on ?? ""))
      .at(-1) ?? null;

  const eicr = latest("eicr");
  const gas = latest("gas_safety_record");
  const epc = latest("epc");

  return {
    "landlord.entity_type": landlord.entity_type,
    "landlord.registered": landlord.landlord_registration_number !== null,

    "property.is_let": property.is_let,
    "property.has_gas": property.has_gas,
    "property.has_fixed_combustion_appliance": property.has_fixed_combustion_appliance,
    "property.hmo": property.hmo,
    "property.type": property.type,
    "property.ownership": property.ownership,
    "property.bedrooms": property.bedrooms,
    "property.storeys": property.storeys,
    "property.licence_kind": property.licence_kind,
    "property.itl1_region": property.itl1_region,

    "tenancy.exists": tenancy !== null,
    "tenancy.kind": tenancy?.kind ?? null,
    "tenancy.deposit_taken": tenancy?.deposit_taken ?? false,
    "tenancy.bills_included": tenancy?.bills_included ?? false,
    "tenancy.households": tenancy?.households ?? 0,
    "tenancy.occupants": tenancy?.occupants ?? 0,
    "tenancy.rent_frequency": tenancy?.rent_frequency ?? null,

    "documents.eicr.outcome": eicr?.outcome ?? null,
    "documents.eicr.exists": eicr !== null,
    "documents.gas.exists": gas !== null,
    "documents.epc.exists": epc !== null,
    "documents.epc.rating": epc?.epc_rating ?? null,

    "registration.status": registration.status,
    "registration.registered": registration.property_registration_number !== null,
  };
}

export class UnknownFactError extends Error {
  constructor(fact: string, ruleId?: string) {
    super(
      `Rule${ruleId ? ` ${ruleId}` : ""} references unknown fact "${fact}". ` +
        `Add it to buildFactBag or fix the rule definition.`,
    );
    this.name = "UnknownFactError";
  }
}

function readFact(
  bag: Record<FactPath, FactValue>,
  fact: FactPath,
  ruleId?: string,
): FactValue {
  if (!(fact in bag)) throw new UnknownFactError(fact, ruleId);
  return bag[fact] ?? null;
}

function asNumber(value: FactValue): number | null {
  return typeof value === "number" ? value : null;
}

/** Evaluate a data-defined predicate against a fact bag. Pure and total. */
export function evaluatePredicate(
  predicate: Predicate,
  bag: Record<FactPath, FactValue>,
  ruleId?: string,
): boolean {
  switch (predicate.op) {
    case "always":
      return true;
    case "never":
      return false;
    case "and":
      return predicate.of.every((p) => evaluatePredicate(p, bag, ruleId));
    case "or":
      return predicate.of.some((p) => evaluatePredicate(p, bag, ruleId));
    case "not":
      return !evaluatePredicate(predicate.of, bag, ruleId);
    case "eq":
      return readFact(bag, predicate.fact, ruleId) === predicate.value;
    case "neq":
      return readFact(bag, predicate.fact, ruleId) !== predicate.value;
    case "in":
      return predicate.values.includes(readFact(bag, predicate.fact, ruleId));
    case "exists": {
      const v = readFact(bag, predicate.fact, ruleId);
      return v !== null && v !== false;
    }
    case "gt": {
      const n = asNumber(readFact(bag, predicate.fact, ruleId));
      return n !== null && n > predicate.value;
    }
    case "gte": {
      const n = asNumber(readFact(bag, predicate.fact, ruleId));
      return n !== null && n >= predicate.value;
    }
    case "lt": {
      const n = asNumber(readFact(bag, predicate.fact, ruleId));
      return n !== null && n < predicate.value;
    }
    case "lte": {
      const n = asNumber(readFact(bag, predicate.fact, ruleId));
      return n !== null && n <= predicate.value;
    }
  }
}

/** Every fact path a predicate touches — used to validate the rule corpus. */
export function factsReferenced(predicate: Predicate): string[] {
  switch (predicate.op) {
    case "always":
    case "never":
      return [];
    case "and":
    case "or":
      return predicate.of.flatMap(factsReferenced);
    case "not":
      return factsReferenced(predicate.of);
    default:
      return [predicate.fact];
  }
}
