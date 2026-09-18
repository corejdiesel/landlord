/**
 * Core domain types for the Let Sorted compliance rule engine.
 *
 * This package is PURE: no I/O, no database, no network, no clock reads.
 * `today` is always passed in so every calculation is testable and the app's
 * "time travel" control works without special cases.
 */

export type Jurisdiction = "england";

export type RuleStatus =
  | "in_force"
  | "commencing"
  | "draft"
  | "proposed"
  | "not_commenced";

export type VerificationStatus =
  | "verified_primary"
  | "verified_secondary"
  | "unverified";

export type ObligationKind =
  | "hold_document"
  | "serve_document"
  | "register"
  | "update_register"
  | "renew"
  | "act_within"
  | "restriction";

/** ITL1 regions used by the PRS Database regional rollout. */
export type Itl1Region =
  | "north_east"
  | "north_west"
  | "yorkshire_and_the_humber"
  | "east_midlands"
  | "west_midlands"
  | "east_of_england"
  | "london"
  | "south_east"
  | "south_west";

export const ITL1_REGIONS: Itl1Region[] = [
  "north_east",
  "north_west",
  "yorkshire_and_the_humber",
  "east_midlands",
  "west_midlands",
  "east_of_england",
  "london",
  "south_east",
  "south_west",
];

export const REGION_LABELS: Record<Itl1Region, string> = {
  north_east: "North East",
  north_west: "North West",
  yorkshire_and_the_humber: "Yorkshire and the Humber",
  east_midlands: "East Midlands",
  west_midlands: "West Midlands",
  east_of_england: "East of England",
  london: "London",
  south_east: "South East",
  south_west: "South West",
};

export type RuleSource = {
  label: string;
  url: string;
  /** ISO date (yyyy-MM-dd) we last checked this source. */
  checked_on: string;
};

/**
 * Predicate expressed as data so rules stay in a versioned table rather than
 * scattered conditionals. Evaluated by `evaluatePredicate`.
 */
export type Predicate =
  | { op: "always" }
  | { op: "never" }
  | { op: "and"; of: Predicate[] }
  | { op: "or"; of: Predicate[] }
  | { op: "not"; of: Predicate }
  | { op: "eq"; fact: FactPath; value: FactValue }
  | { op: "neq"; fact: FactPath; value: FactValue }
  | { op: "in"; fact: FactPath; values: FactValue[] }
  | { op: "gt"; fact: FactPath; value: number }
  | { op: "gte"; fact: FactPath; value: number }
  | { op: "lt"; fact: FactPath; value: number }
  | { op: "lte"; fact: FactPath; value: number }
  | { op: "exists"; fact: FactPath };

export type FactValue = string | number | boolean | null;

/** Dotted path into the flattened fact bag, e.g. "property.has_gas". */
export type FactPath = string;

export type EffectiveResolver =
  | "prs_region_commencement"
  | "prs_region_deadline";

export type Rule = {
  id: string;
  version: number;
  /** Plain English, <= 60 chars. */
  title: string;
  /** Plain English, <= 240 chars. */
  summary: string;
  jurisdiction: Jurisdiction;
  status: RuleStatus;
  /** ISO date, or null when region-resolved / not yet known. */
  effective_from: string | null;
  effective_resolver?: EffectiveResolver;
  applies_when: Predicate;
  obligation: {
    kind: ObligationKind;
    cadence?: {
      every_months?: number;
      within_days?: number;
      of_event?: string;
    };
  };
  /** Only populated where we have a source for the figure. */
  consequence_pennies_max?: bigint;
  sources: RuleSource[];
  verification_status: VerificationStatus;
  reviewer_note?: string;
  /** Informational rules describe the law but never generate obligations. */
  informational?: boolean;
};

// ---------------------------------------------------------------------------
// Facts the engine reasons over
// ---------------------------------------------------------------------------

export type PropertyType =
  | "detached"
  | "semi_detached"
  | "terraced"
  | "flat"
  | "other";

export type Ownership =
  | "freehold"
  | "leasehold"
  | "share_of_freehold"
  | "commonhold";

export type LicenceKind =
  | "selective"
  | "hmo_mandatory"
  | "hmo_additional"
  | "none_needed";

export type TenancyKind =
  | "assured"
  | "rent_act_regulated"
  | "lodger"
  | "high_rent"
  | "low_rent"
  | "supported_exempt"
  | "other";

export type RentFrequency = "monthly" | "four_weekly" | "weekly" | "other";

export type DocumentKind =
  | "gas_safety_record"
  | "eicr"
  | "eic"
  | "epc"
  | "licence"
  | "deposit_certificate"
  | "tenancy_agreement"
  | "prescribed_information"
  | "right_to_rent_check"
  | "other";

export type DocumentOutcome =
  | "satisfactory"
  | "unsatisfactory"
  | "not_applicable"
  | "unknown";

export type ComplianceDocument = {
  id: string;
  property_id: string;
  kind: DocumentKind;
  /** ISO date the document was issued. */
  issued_on: string | null;
  /** ISO date it expires or the next check is due, when known. */
  expires_on: string | null;
  outcome: DocumentOutcome;
  /** ISO date this document was served on the tenant, when relevant. */
  served_on_tenant_at: string | null;
  /** EPC band A-G, only for kind === "epc". */
  epc_rating?: string | null;
  confirmed_at: string | null;
};

export type PropertyFacts = {
  id: string;
  postcode: string;
  itl1_region: Itl1Region;
  type: PropertyType;
  ownership: Ownership;
  bedrooms: number;
  has_gas: boolean;
  has_fixed_combustion_appliance: boolean;
  storeys: number;
  hmo: boolean;
  licence_kind: LicenceKind;
  licence_expires_on: string | null;
  is_let: boolean;
};

export type TenancyFacts = {
  id: string;
  property_id: string;
  kind: TenancyKind;
  started_on: string;
  ended_on: string | null;
  rent_pennies: bigint;
  rent_frequency: RentFrequency;
  bills_included: boolean;
  households: number;
  occupants: number;
  deposit_taken: boolean;
  deposit_pennies: bigint;
  deposit_protected_on: string | null;
  prescribed_information_served_on: string | null;
  right_to_rent_checked_on: string | null;
  right_to_rent_follow_up_on: string | null;
  alarms_tested_on: string | null;
};

export type RegistrationFacts = {
  property_id: string;
  property_registration_number: string | null;
  registered_on: string | null;
  renewal_due_on: string | null;
  status: "none" | "active" | "inactive" | "lapsed";
};

export type LandlordFacts = {
  id: string;
  entity_type: "individual" | "company" | "trust" | "representative";
  landlord_registration_number: string | null;
  registered_on: string | null;
};

/** Everything the engine needs for one evaluation. */
export type EvaluationInput = {
  landlord: LandlordFacts;
  property: PropertyFacts;
  tenancy: TenancyFacts | null;
  documents: ComplianceDocument[];
  registration: RegistrationFacts;
  /** ISO date. The engine never reads the system clock. */
  today: string;
};

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

export type ObligationState =
  | "not_yet_applicable"
  | "upcoming"
  | "due_soon"
  | "overdue"
  | "satisfied"
  | "blocked";

export type Obligation = {
  rule_id: string;
  rule_version: number;
  property_id: string;
  title: string;
  summary: string;
  kind: ObligationKind;
  /** ISO date the obligation must be met by, when one can be computed. */
  due_on: string | null;
  state: ObligationState;
  /** Days until due_on; negative when overdue. Null when no due date. */
  days_remaining: number | null;
  /** Document id or other reference that satisfies this obligation. */
  satisfied_by: string | null;
  /** Plain-English explanation of why this obligation is in this state. */
  reason: string;
  sources: RuleSource[];
  verification_status: VerificationStatus;
  status: RuleStatus;
  consequence_pennies_max?: bigint;
};
