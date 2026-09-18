import type {
  ComplianceDocument,
  EvaluationInput,
  LandlordFacts,
  PropertyFacts,
  RegistrationFacts,
  TenancyFacts,
} from "../src/types.js";

/** Scenario fixtures. Builders take overrides so each test states only what it cares about. */

export function aLandlord(over: Partial<LandlordFacts> = {}): LandlordFacts {
  return {
    id: "landlord-1",
    entity_type: "individual",
    landlord_registration_number: null,
    registered_on: null,
    ...over,
  };
}

export function aProperty(over: Partial<PropertyFacts> = {}): PropertyFacts {
  return {
    id: "property-1",
    postcode: "B1 1AA",
    itl1_region: "west_midlands",
    type: "terraced",
    ownership: "freehold",
    bedrooms: 3,
    has_gas: true,
    has_fixed_combustion_appliance: true,
    storeys: 2,
    hmo: false,
    licence_kind: "none_needed",
    licence_expires_on: null,
    is_let: true,
    ...over,
  };
}

export function aTenancy(over: Partial<TenancyFacts> = {}): TenancyFacts {
  return {
    id: "tenancy-1",
    property_id: "property-1",
    kind: "assured",
    started_on: "2025-06-01",
    ended_on: null,
    rent_pennies: 125000n,
    rent_frequency: "monthly",
    bills_included: false,
    households: 1,
    occupants: 2,
    deposit_taken: true,
    deposit_pennies: 144000n,
    deposit_protected_on: "2025-06-10",
    prescribed_information_served_on: "2025-06-10",
    right_to_rent_checked_on: "2025-05-28",
    right_to_rent_follow_up_on: null,
    alarms_tested_on: "2025-06-01",
    ...over,
  };
}

export function aRegistration(over: Partial<RegistrationFacts> = {}): RegistrationFacts {
  return {
    property_id: "property-1",
    property_registration_number: null,
    registered_on: null,
    renewal_due_on: null,
    status: "none",
    ...over,
  };
}

export function aDocument(over: Partial<ComplianceDocument> = {}): ComplianceDocument {
  return {
    id: "doc-1",
    property_id: "property-1",
    kind: "gas_safety_record",
    issued_on: "2026-06-01",
    expires_on: "2027-06-01",
    outcome: "satisfactory",
    served_on_tenant_at: "2026-06-05",
    epc_rating: null,
    confirmed_at: "2026-06-02T09:00:00Z",
    ...over,
  };
}

export function anInput(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    landlord: aLandlord(),
    property: aProperty(),
    tenancy: aTenancy(),
    documents: [],
    registration: aRegistration(),
    today: "2026-09-18",
    ...over,
  };
}

/** A fully compliant London flat, used as the "nothing should fire" baseline. */
export function compliantScenario(today = "2026-09-18"): EvaluationInput {
  return anInput({
    today,
    property: aProperty({ itl1_region: "london", type: "flat", ownership: "leasehold" }),
    documents: [
      aDocument({ id: "gas-1", kind: "gas_safety_record", issued_on: "2026-06-01", expires_on: "2027-06-01" }),
      aDocument({ id: "eicr-1", kind: "eicr", issued_on: "2024-03-01", expires_on: "2029-03-01", outcome: "satisfactory" }),
      aDocument({ id: "epc-1", kind: "epc", issued_on: "2020-01-01", expires_on: "2030-01-01", epc_rating: "C" }),
    ],
  });
}
