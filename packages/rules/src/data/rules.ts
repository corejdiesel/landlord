import type { Rule, RuleSource } from "../types.js";

/**
 * Seed compliance rule corpus.
 *
 * HARD CONSTRAINT (spec 6.1): nothing in this file may be marked
 * `verified_primary`. That promotion is a human job after legal review.
 * The most an automated build may assign is `verified_secondary`, and anything
 * whose detail could not be traced to a source ships as `unverified`, which the
 * app feature-flags away from end users.
 */

const HOUSING_HUB: RuleSource = {
  label: "GOV.UK Housing Hub — Get ready to register",
  url: "https://housinghub.campaign.gov.uk/renting-is-changing/get-ready-to-register/",
  checked_on: "2026-09-18",
};

const DRAFT_REGS: RuleSource = {
  label: "Draft Private Rented Sector Database Regulations 2026",
  url: "https://www.legislation.gov.uk/ukdsi/2026/9780348286861/data.pdf",
  checked_on: "2026-09-18",
};

const EXPLANATORY_MEMO: RuleSource = {
  label: "Explanatory Memorandum to the draft PRS Database Regulations 2026",
  url: "https://www.legislation.gov.uk/ukdsi/2026/9780348286861/pdfs/ukdsiem_9780348286861_en_001.pdf",
  checked_on: "2026-09-18",
};

const RRA_2025: RuleSource = {
  label: "Renters' Rights Act 2025, Part 2 Chapter 3",
  url: "https://www.legislation.gov.uk/ukpga/2025/26/part/2/chapter/3/enacted",
  checked_on: "2026-09-18",
};

const GAS_REGS: RuleSource = {
  label: "Gas Safety (Installation and Use) Regulations 1998, reg. 36",
  url: "https://www.legislation.gov.uk/uksi/1998/2451/regulation/36",
  checked_on: "2026-09-18",
};

const ELEC_REGS: RuleSource = {
  label: "Electrical Safety Standards in the Private Rented Sector (England) Regulations 2020",
  url: "https://www.legislation.gov.uk/uksi/2020/312/contents/made",
  checked_on: "2026-09-18",
};

const MEES_REGS: RuleSource = {
  label: "Energy Efficiency (Private Rented Property) (England and Wales) Regulations 2015",
  url: "https://www.legislation.gov.uk/uksi/2015/962/contents/made",
  checked_on: "2026-09-18",
};

const ALARM_REGS: RuleSource = {
  label: "Smoke and Carbon Monoxide Alarm (England) Regulations 2015 (as amended 2022)",
  url: "https://www.legislation.gov.uk/uksi/2015/1693/contents",
  checked_on: "2026-09-18",
};

const HOUSING_ACT_2004: RuleSource = {
  label: "Housing Act 2004, Part 6 Chapter 4 (tenancy deposit schemes)",
  url: "https://www.legislation.gov.uk/ukpga/2004/34/part/6/chapter/4",
  checked_on: "2026-09-18",
};

const RIGHT_TO_RENT: RuleSource = {
  label: "GOV.UK — Right to rent checks: landlord's guide",
  url: "https://www.gov.uk/government/publications/right-to-rent-landlords-code-of-practice",
  checked_on: "2026-09-18",
};

const LICENSING_SRC: RuleSource = {
  label: "Housing Act 2004, Parts 2 and 3 (HMO and selective licensing)",
  url: "https://www.legislation.gov.uk/ukpga/2004/34/contents",
  checked_on: "2026-09-18",
};

const LEGIONELLA_SRC: RuleSource = {
  label: "HSE — Legionella and landlords' responsibilities",
  url: "https://www.hse.gov.uk/legionnaires/legionella-landlords-responsibilities.htm",
  checked_on: "2026-09-18",
};

const ICO_SRC: RuleSource = {
  label: "ICO — Data protection fee self-assessment",
  url: "https://ico.org.uk/for-organisations/data-protection-fee/self-assessment/",
  checked_on: "2026-09-18",
};

/**
 * A let that is in scope for the PRS Database: assured or Rent Act regulated,
 * currently let, and not one of the carved-out categories.
 */
const IN_SCOPE_LET: Rule["applies_when"] = {
  op: "and",
  of: [
    { op: "eq", fact: "property.is_let", value: true },
    { op: "in", fact: "tenancy.kind", values: ["assured", "rent_act_regulated"] },
  ],
};

export const SEED_RULES: Rule[] = [
  // -------------------------------------------------------------------------
  // PRS Database
  // -------------------------------------------------------------------------
  {
    id: "PRS-REG-LANDLORD",
    version: 1,
    title: "Register yourself as a landlord",
    summary:
      "Every residential landlord needs their own active landlord entry on the database. Joint landlords each need one. The landlord entry itself is free.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_deadline",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "register" },
    consequence_pennies_max: 700000n,
    sources: [HOUSING_HUB, DRAFT_REGS, RRA_2025],
    verification_status: "verified_secondary",
    reviewer_note:
      "Confirm against the made regulations: whether the landlord entry deadline is the same date as the dwelling entry deadline, and the exact treatment of joint landlords.",
  },
  {
    id: "PRS-REG-DWELLING",
    version: 1,
    title: "Register the property",
    summary:
      "Each let property needs its own active dwelling entry by your region's deadline. It costs £65 a year. Joint landlords share one dwelling entry.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_deadline",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "register" },
    consequence_pennies_max: 700000n,
    sources: [HOUSING_HUB, DRAFT_REGS, EXPLANATORY_MEMO],
    verification_status: "verified_secondary",
    reviewer_note:
      "Carve-outs to confirm: lodgers, high-rent lets at or above £100,000 a year, low-rent lets, and supported exempt accommodation.",
  },
  {
    id: "PRS-UPDATE-28D",
    version: 1,
    title: "Keep your entry up to date",
    summary:
      "If anything on your database entry becomes out of date — rent, occupants, certificates, agent — you have 28 days to update it.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_commencement",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "update_register", cadence: { within_days: 28, of_event: "fact_changed" } },
    consequence_pennies_max: 700000n,
    sources: [DRAFT_REGS, EXPLANATORY_MEMO],
    verification_status: "verified_secondary",
    reviewer_note:
      "Confirm the 28-day window runs from the information becoming out of date, not from the landlord becoming aware of it.",
  },
  {
    id: "PRS-GAS-UPLOAD",
    version: 1,
    title: "Upload your gas safety record",
    summary:
      "A new gas safety record has to be added to your database entry within 28 days of the check.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_commencement",
    applies_when: {
      op: "and",
      of: [IN_SCOPE_LET, { op: "eq", fact: "property.has_gas", value: true }],
    },
    obligation: { kind: "update_register", cadence: { within_days: 28, of_event: "gas_certificate_issued" } },
    consequence_pennies_max: 700000n,
    sources: [DRAFT_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "PRS-RENEW-ANNUAL",
    version: 1,
    title: "Renew your entry every year",
    summary:
      "Entries last one year and renewal is manual — there is no direct debit, because you have to re-confirm the details are still correct.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_commencement",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "renew", cadence: { every_months: 12, of_event: "first_dwelling_entry" } },
    sources: [HOUSING_HUB, DRAFT_REGS],
    verification_status: "verified_secondary",
    reviewer_note:
      "Confirm that renewal dates synchronise to the anniversary of the landlord's FIRST dwelling entry rather than each property's own anniversary.",
  },
  {
    id: "PRS-POSSESSION-BAR",
    version: 1,
    title: "Registration affects possession",
    summary:
      "A court cannot make a possession order while you are in breach of the registration duties, apart from on Grounds 7A and 14.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    effective_resolver: "prs_region_deadline",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "restriction" },
    sources: [RRA_2025, EXPLANATORY_MEMO],
    verification_status: "verified_secondary",
    informational: true,
    reviewer_note:
      "Possession is a legal process. This rule must never present as advice — it drives a checklist indicator only.",
  },
  {
    id: "PRS-MARKETING-IDS",
    version: 1,
    title: "Advert identifiers (coming later)",
    summary:
      "In future, adverts will have to carry your entry identifiers and you will not be able to market a property without active entries. This is not in force yet.",
    jurisdiction: "england",
    status: "not_commenced",
    effective_from: null,
    applies_when: { op: "never" },
    obligation: { kind: "restriction" },
    sources: [RRA_2025],
    verification_status: "verified_secondary",
    informational: true,
    reviewer_note: "Renters' Rights Act 2025 s.82(1)-(2) not yet commenced. Creates no obligations.",
  },
  {
    id: "PRS-PENALTIES",
    version: 1,
    title: "What the penalties are",
    summary:
      "Breaching the registration duties can bring a civil penalty of up to £7,000. False information, or continuing and repeat breaches, can bring up to £40,000 or prosecution.",
    jurisdiction: "england",
    status: "commencing",
    effective_from: null,
    applies_when: { op: "always" },
    obligation: { kind: "restriction" },
    consequence_pennies_max: 4000000n,
    sources: [RRA_2025, EXPLANATORY_MEMO, HOUSING_HUB],
    verification_status: "verified_secondary",
    informational: true,
  },

  // -------------------------------------------------------------------------
  // Long-standing duties
  // -------------------------------------------------------------------------
  {
    id: "GAS-ANNUAL",
    version: 1,
    title: "Annual gas safety check",
    summary:
      "Every gas appliance and flue must be checked by a Gas Safe registered engineer every 12 months. Give the record to existing tenants within 28 days, and to new tenants before they move in.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "1998-10-31",
    applies_when: {
      op: "and",
      of: [
        { op: "eq", fact: "property.is_let", value: true },
        { op: "eq", fact: "property.has_gas", value: true },
      ],
    },
    obligation: { kind: "hold_document", cadence: { every_months: 12, within_days: 28, of_event: "gas_certificate_issued" } },
    sources: [GAS_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "ELEC-5Y",
    version: 1,
    title: "Electrical safety report every 5 years",
    summary:
      "You need an electrical installation condition report at least every 5 years, or sooner if the report says so. Give a copy to tenants within 28 days.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2020-07-01",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "hold_document", cadence: { every_months: 60, within_days: 28, of_event: "eicr_issued" } },
    sources: [ELEC_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "ELEC-REMEDIAL-28D",
    version: 1,
    title: "Fix unsatisfactory electrical work",
    summary:
      "If your report is unsatisfactory, the work must be done within 28 days — or sooner if the report specifies — and you need written confirmation it is complete.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2020-07-01",
    applies_when: {
      op: "and",
      of: [
        { op: "eq", fact: "property.is_let", value: true },
        { op: "eq", fact: "documents.eicr.outcome", value: "unsatisfactory" },
      ],
    },
    obligation: { kind: "act_within", cadence: { within_days: 28, of_event: "eicr_issued" } },
    sources: [ELEC_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "EPC-VALID",
    version: 1,
    title: "Valid EPC of at least E",
    summary:
      "You need a valid energy performance certificate to let, and the rating must be E or better unless you have a registered exemption.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2018-04-01",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "hold_document", cadence: { every_months: 120 } },
    sources: [MEES_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "EPC-C-PROPOSED",
    version: 1,
    title: "Minimum EPC C (proposed)",
    summary:
      "The government has proposed raising the minimum rating to C for private rentals. This is a proposal — it creates no obligation today.",
    jurisdiction: "england",
    status: "proposed",
    effective_from: null,
    applies_when: { op: "never" },
    obligation: { kind: "hold_document" },
    sources: [MEES_REGS],
    verification_status: "unverified",
    informational: true,
    reviewer_note: "TODO(verify): confirm the current status and any announced date for the move to EPC C.",
  },
  {
    id: "ALARMS",
    version: 1,
    title: "Smoke and carbon monoxide alarms",
    summary:
      "A smoke alarm on every storey, and a carbon monoxide alarm in any room with a fixed combustion appliance other than a gas cooker. Test them on the first day of the tenancy.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2022-10-01",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "act_within", cadence: { within_days: 0, of_event: "tenancy_started" } },
    sources: [ALARM_REGS],
    verification_status: "verified_secondary",
  },
  {
    id: "DEPOSIT-30D",
    version: 1,
    title: "Protect the deposit within 30 days",
    summary:
      "A deposit must be protected in an approved scheme within 30 days of receiving it, and you must serve the prescribed information in the same window.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2007-04-06",
    applies_when: {
      op: "and",
      of: [
        { op: "eq", fact: "property.is_let", value: true },
        { op: "eq", fact: "tenancy.deposit_taken", value: true },
      ],
    },
    obligation: { kind: "act_within", cadence: { within_days: 30, of_event: "tenancy_started" } },
    sources: [HOUSING_ACT_2004],
    verification_status: "verified_secondary",
  },
  {
    id: "RIGHT-TO-RENT",
    version: 1,
    title: "Right to rent checks",
    summary:
      "Check every adult occupier's right to rent before the tenancy starts, and check again before time-limited permission runs out.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2016-02-01",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "act_within", cadence: { within_days: 0, of_event: "tenancy_started" } },
    sources: [RIGHT_TO_RENT],
    verification_status: "verified_secondary",
  },
  {
    id: "LICENSING",
    version: 1,
    title: "Keep your licence current",
    summary:
      "Where the council requires a selective, additional or mandatory HMO licence, it must be held and in date. Registering on the database does not replace licensing.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2006-04-06",
    applies_when: {
      op: "and",
      of: [
        { op: "eq", fact: "property.is_let", value: true },
        { op: "neq", fact: "property.licence_kind", value: "none_needed" },
      ],
    },
    obligation: { kind: "hold_document" },
    sources: [LICENSING_SRC],
    verification_status: "verified_secondary",
  },
  {
    id: "LEGIONELLA",
    version: 1,
    title: "Legionella risk assessment",
    summary:
      "Good practice: assess the risk of legionella in the water system. There is no certificate to hold and no formal expiry — this is guidance, not a certificate duty.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2013-01-01",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "act_within" },
    sources: [LEGIONELLA_SRC],
    verification_status: "verified_secondary",
    informational: true,
    reviewer_note: "Must be presented as guidance and a low-priority nudge, never as a certificate requirement.",
  },
  {
    id: "ICO-FEE",
    version: 1,
    title: "Data protection fee",
    summary:
      "Some landlords need to pay a data protection fee to the ICO. Whether it applies depends on how you handle tenant data — check your own position.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2018-05-25",
    applies_when: { op: "eq", fact: "property.is_let", value: true },
    obligation: { kind: "act_within", cadence: { every_months: 12 } },
    sources: [ICO_SRC],
    verification_status: "verified_secondary",
    informational: true,
    reviewer_note: "Label clearly as 'check whether this applies to you'. Never assert that it does.",
  },
];

/**
 * Renters' Rights Act Phase 1 (from 1 May 2026).
 *
 * Every one of these ships `unverified` per spec 6.2: the numeric parameters
 * are not confirmed. The shells exist so the UI, reminder hooks and rule IDs
 * are in place; a human fills in the numbers after legal review.
 */
export const RRA_PHASE_1_RULES: Rule[] = [
  {
    id: "RRA-RENT-INCREASE-LIMIT",
    version: 1,
    title: "Rent increases: once a year",
    summary:
      "Rent increases go through the statutory route, limited in frequency, with a minimum notice period. The exact figures are being confirmed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "act_within", cadence: { every_months: 12 } },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): annual limit and the exact notice period for a statutory rent increase notice.",
  },
  {
    id: "RRA-BIDDING-BAN",
    version: 1,
    title: "No rental bidding",
    summary:
      "You must advertise a rent and cannot accept offers above it. The detail is being confirmed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "restriction" },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): scope of the prohibition and how it interacts with advertised rent ranges.",
  },
  {
    id: "RRA-RENT-IN-ADVANCE-CAP",
    version: 1,
    title: "Cap on rent in advance",
    summary: "There is a limit on how much rent you can ask for up front. The cap is being confirmed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "restriction" },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): the cap, expressed as a number of months or weeks of rent.",
  },
  {
    id: "RRA-PET-REQUESTS",
    version: 1,
    title: "Respond to pet requests",
    summary:
      "You must consider a tenant's request to keep a pet and respond within a set period. The period is being confirmed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "act_within", cadence: { within_days: 28, of_event: "pet_request_received" } },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): the statutory response period. 28 days is a placeholder, not a sourced figure.",
  },
  {
    id: "RRA-WRITTEN-STATEMENT",
    version: 1,
    title: "Written statement of terms",
    summary: "Tenants must get a written statement of the tenancy terms. The required contents are being confirmed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "serve_document", cadence: { within_days: 28, of_event: "tenancy_started" } },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): prescribed contents and the deadline for serving it.",
  },
  {
    id: "RRA-INFO-SHEET",
    version: 1,
    title: "Information sheet for existing tenancies",
    summary:
      "Tenancies that existed before the new rules started must be given an information sheet explaining what changed.",
    jurisdiction: "england",
    status: "in_force",
    effective_from: "2026-05-01",
    applies_when: IN_SCOPE_LET,
    obligation: { kind: "serve_document", cadence: { within_days: 28, of_event: "rra_commencement" } },
    sources: [RRA_2025],
    verification_status: "unverified",
    reviewer_note: "TODO(verify): the deadline for serving the information sheet on pre-existing tenancies.",
  },
];

/** Informational only — no obligations, shown as 'what's coming'. */
export const FUTURE_RULES: Rule[] = [
  {
    id: "FUTURE-OMBUDSMAN",
    version: 1,
    title: "Landlord Ombudsman (proposed)",
    summary: "Landlords will be required to join a new PRS Landlord Ombudsman scheme. Not in force yet.",
    jurisdiction: "england",
    status: "proposed",
    effective_from: null,
    applies_when: { op: "never" },
    obligation: { kind: "register" },
    sources: [RRA_2025],
    verification_status: "unverified",
    informational: true,
  },
  {
    id: "FUTURE-DECENT-HOMES",
    version: 1,
    title: "Decent Homes Standard (proposed)",
    summary: "A Decent Homes Standard is proposed for the private rented sector. Not in force yet.",
    jurisdiction: "england",
    status: "proposed",
    effective_from: null,
    applies_when: { op: "never" },
    obligation: { kind: "act_within" },
    sources: [RRA_2025],
    verification_status: "unverified",
    informational: true,
  },
  {
    id: "FUTURE-AWAABS-LAW",
    version: 1,
    title: "Awaab's Law in the PRS (proposed)",
    summary: "Fixed timescales for dealing with damp, mould and other hazards are proposed for private rentals.",
    jurisdiction: "england",
    status: "proposed",
    effective_from: null,
    applies_when: { op: "never" },
    obligation: { kind: "act_within" },
    sources: [RRA_2025],
    verification_status: "unverified",
    informational: true,
  },
];

export const ALL_RULES: Rule[] = [...SEED_RULES, ...RRA_PHASE_1_RULES, ...FUTURE_RULES];

export function ruleById(id: string, corpus: Rule[] = ALL_RULES): Rule | undefined {
  return corpus.find((r) => r.id === id);
}
