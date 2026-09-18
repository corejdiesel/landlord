/**
 * Registration Rehearsal.
 *
 * Mirrors the government's question set, in the government's order, with the
 * government's answer options — so that when the landlord sits down with the
 * real form there are no surprises and nothing to go and look up.
 *
 * SOURCE STATUS: the field list is taken from the spec's reading of Schedule 3
 * of the draft regulations and a beta tester's account of the form. It is
 * `verified_secondary` at best and must be checked against the live service.
 * The order matters as much as the content — that is the whole point — so any
 * correction should preserve ordering.
 */

export type RehearsalFieldType =
  | "text" | "email" | "postcode" | "number" | "money" | "date"
  | "choice" | "boolean" | "long_text";

export type RehearsalField = {
  id: string;
  /** The question, worded as the government asks it. */
  question: string;
  type: RehearsalFieldType;
  /** Options in the government's order, where it is a choice. */
  options?: { value: string; label: string }[];
  /** Our own plain-English help. Never presented as official wording. */
  help?: string;
  required: boolean;
  /** Where we can prefill this from the landlord's own data. */
  source?: "property" | "tenancy" | "entity" | "document" | "manual";
  /** Only asked when this predicate over earlier answers holds. */
  only_if?: { field: string; equals: string | boolean };
};

export type RehearsalSection = {
  id: string;
  title: string;
  /** Why this section exists, in one sentence. */
  intro?: string;
  fields: RehearsalField[];
};

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const REHEARSAL_SECTIONS: RehearsalSection[] = [
  {
    id: "property",
    title: "The property",
    intro: "The service starts by finding the property from its postcode and number.",
    fields: [
      { id: "postcode", question: "What is the property's postcode?", type: "postcode", required: true, source: "property" },
      { id: "house_number", question: "What is the house or flat number?", type: "text", required: true, source: "property" },
      {
        id: "property_type",
        question: "What type of property is it?",
        type: "choice",
        required: true,
        source: "property",
        options: [
          { value: "detached", label: "Detached" },
          { value: "semi_detached", label: "Semi-detached" },
          { value: "terraced", label: "Terraced" },
          { value: "flat", label: "Flat" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "ownership",
        question: "How do you own it?",
        type: "choice",
        required: true,
        source: "property",
        options: [
          { value: "freehold", label: "Freehold" },
          { value: "leasehold", label: "Leasehold" },
          { value: "share_of_freehold", label: "Share of freehold" },
          { value: "commonhold", label: "Commonhold" },
        ],
      },
    ],
  },
  {
    id: "landlord",
    title: "You, as the landlord",
    intro:
      "Your correspondence address has to be in England or Wales and cannot be a PO box. " +
      "If you own the property jointly, each of you needs your own landlord entry.",
    fields: [
      { id: "landlord_name", question: "What is your name?", type: "text", required: true, source: "entity" },
      { id: "correspondence_line1", question: "What is your correspondence address?", type: "text", required: true, source: "entity", help: "Must be in England or Wales. PO boxes are not accepted." },
      { id: "correspondence_town", question: "Town or city", type: "text", required: true, source: "entity" },
      { id: "correspondence_postcode", question: "Postcode", type: "postcode", required: true, source: "entity" },
      { id: "landlord_email", question: "What is your email address?", type: "email", required: true, source: "entity" },
    ],
  },
  {
    id: "licensing",
    title: "Licensing",
    intro:
      "Registering on the database is in addition to any council licence. It does not replace one.",
    fields: [
      {
        id: "licence_kind",
        question: "Does the property need a licence from the council?",
        type: "choice",
        required: true,
        source: "property",
        options: [
          { value: "selective", label: "Yes — selective licence" },
          { value: "hmo_mandatory", label: "Yes — mandatory HMO licence" },
          { value: "hmo_additional", label: "Yes — additional HMO licence" },
          { value: "none_needed", label: "No licence needed" },
        ],
      },
      {
        id: "licence_number",
        question: "What is the licence number?",
        type: "text",
        required: false,
        source: "property",
        only_if: { field: "licence_kind", equals: "selective" },
      },
    ],
  },
  {
    id: "occupancy",
    title: "Who lives there",
    intro:
      "Count everyone who lives there permanently, including children and babies. " +
      "Do not count guests staying less than 90 days.",
    fields: [
      { id: "is_occupied", question: "Is the property currently occupied by tenants?", type: "choice", options: YES_NO, required: true, source: "tenancy" },
      { id: "households", question: "How many households live there?", type: "number", required: true, source: "tenancy", help: "A household is one person or a family living together. A shared house with three unrelated tenants is three households." },
      { id: "occupants", question: "How many people live there in total?", type: "number", required: true, source: "tenancy", help: "Include children and babies. Exclude guests staying under 90 days." },
      { id: "bedrooms", question: "How many bedrooms does it have?", type: "number", required: true, source: "property", help: "Do not count rooms smaller than 4.64 square metres." },
    ],
  },
  {
    id: "tenancy",
    title: "The letting",
    fields: [
      { id: "bills_included", question: "Does the rent include bills?", type: "choice", options: YES_NO, required: true, source: "tenancy" },
      {
        id: "furnished",
        question: "Is it furnished?",
        type: "choice",
        required: true,
        source: "property",
        options: [
          { value: "furnished", label: "Furnished" },
          { value: "part_furnished", label: "Part furnished" },
          { value: "unfurnished", label: "Unfurnished" },
        ],
      },
      {
        id: "rent_frequency",
        question: "How often is rent paid?",
        type: "choice",
        required: true,
        source: "tenancy",
        options: [
          { value: "monthly", label: "Monthly" },
          { value: "four_weekly", label: "Every 4 weeks" },
          { value: "weekly", label: "Weekly" },
          { value: "other", label: "Other" },
        ],
      },
      { id: "rent_amount", question: "How much is the rent?", type: "money", required: true, source: "tenancy" },
    ],
  },
  {
    id: "safety",
    title: "Safety certificates",
    intro: "You will be asked to upload the gas safety record if the property has gas.",
    fields: [
      { id: "has_gas", question: "Does the property have a gas supply or gas appliances?", type: "choice", options: YES_NO, required: true, source: "property" },
      {
        id: "gas_certificate",
        question: "Upload the gas safety record",
        type: "text",
        required: true,
        source: "document",
        only_if: { field: "has_gas", equals: "yes" },
        help: "The most recent one. It must be within the last 12 months.",
      },
      {
        id: "electrical_certificate_type",
        question: "What electrical certificate do you have?",
        type: "choice",
        required: true,
        source: "document",
        options: [
          { value: "eic", label: "Electrical Installation Certificate (EIC)" },
          { value: "eicr", label: "Electrical Installation Condition Report (EICR)" },
          { value: "none", label: "Neither" },
        ],
      },
      { id: "epc_confirm", question: "Is this the right EPC for the property?", type: "choice", options: YES_NO, required: true, source: "document", help: "The service finds your EPC from the register. You confirm it is the right one." },
    ],
  },
  {
    id: "others",
    title: "Other people involved",
    intro:
      "If you do not have these details, the ones on your lease are what to use.",
    fields: [
      { id: "freeholder_name", question: "Who is the freeholder?", type: "text", required: false, source: "property" },
      { id: "freeholder_email", question: "Freeholder's email address", type: "email", required: false, source: "property" },
      { id: "superior_landlord_name", question: "Is there a superior landlord?", type: "text", required: false, source: "property" },
      { id: "property_manager_name", question: "Who manages the property?", type: "text", required: false, source: "property" },
      { id: "property_manager_email", question: "Property manager's email address", type: "email", required: false, source: "property" },
    ],
  },
];

/** Extra questions for a company, LLP, trust or someone acting for another. */
export const ENTITY_SECTIONS: Record<string, RehearsalSection> = {
  company: {
    id: "company",
    title: "Your company",
    intro: "You will need the company number, or the details of every director.",
    fields: [
      { id: "companies_house_number", question: "What is the company number?", type: "text", required: true, source: "entity" },
      { id: "company_name", question: "What is the registered company name?", type: "text", required: true, source: "entity" },
      { id: "person_making_entry", question: "Who is making this entry?", type: "text", required: true, source: "manual" },
      { id: "nominated_contact", question: "Who is the nominated contact?", type: "text", required: true, source: "manual" },
    ],
  },
  trust: {
    id: "trust",
    title: "The trust",
    fields: [
      { id: "trust_name", question: "What is the trust called?", type: "text", required: true, source: "entity" },
      { id: "lead_trustee_name", question: "Who is the lead trustee?", type: "text", required: true, source: "entity" },
      { id: "lead_trustee_email", question: "Lead trustee's email address", type: "email", required: true, source: "entity" },
    ],
  },
  representative: {
    id: "representative",
    title: "Acting on someone's behalf",
    intro:
      "You will need certified evidence of your authority to act. Get this ready before you start.",
    fields: [
      { id: "represented_name", question: "Who are you acting for?", type: "text", required: true, source: "entity" },
      { id: "authority_evidence", question: "What evidence of authority do you have?", type: "long_text", required: true, source: "manual" },
    ],
  },
};

export type RehearsalAnswers = Record<string, string | number | boolean | null>;

export type Blocker = {
  field_id: string;
  section_id: string;
  question: string;
  /** What specifically is missing, and what to do about it. */
  message: string;
};

export type Readiness = {
  /** 0..100. */
  score: number;
  answered: number;
  required: number;
  blockers: Blocker[];
  ready: boolean;
};

/** Which fields apply, given the answers so far and the entity type. */
export function applicableFields(
  answers: RehearsalAnswers,
  entityType: "individual" | "company" | "trust" | "representative" = "individual",
): { section: RehearsalSection; field: RehearsalField }[] {
  const sections = [...REHEARSAL_SECTIONS];
  const extra = ENTITY_SECTIONS[entityType];
  if (extra) sections.splice(2, 0, extra);

  const out: { section: RehearsalSection; field: RehearsalField }[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      if (field.only_if) {
        const actual = answers[field.only_if.field];
        if (actual !== field.only_if.equals) continue;
      }
      out.push({ section, field });
    }
  }
  return out;
}

/**
 * Readiness score and specific blockers.
 *
 * Blockers name the thing and say what to do — "No electrical certificate on
 * file" beats "incomplete", and "use the details on your lease" beats leaving
 * someone stuck on a question they cannot answer.
 */
export function readiness(
  answers: RehearsalAnswers,
  entityType: "individual" | "company" | "trust" | "representative" = "individual",
): Readiness {
  const fields = applicableFields(answers, entityType);
  const required = fields.filter(({ field }) => field.required);

  const blockers: Blocker[] = [];
  let answered = 0;

  for (const { section, field } of required) {
    const value = answers[field.id];
    const missing = value === undefined || value === null || value === "";
    if (missing) {
      blockers.push({
        field_id: field.id,
        section_id: section.id,
        question: field.question,
        message: blockerMessage(field),
      });
    } else {
      answered++;
    }
  }

  const score = required.length === 0 ? 100 : Math.round((answered / required.length) * 100);
  return { score, answered, required: required.length, blockers, ready: blockers.length === 0 };
}

function blockerMessage(field: RehearsalField): string {
  switch (field.id) {
    case "gas_certificate":
      return "No gas safety record on file. Upload one, or forward it to your Cert Inbox address.";
    case "electrical_certificate_type":
      return "No electrical certificate recorded. You need an EIC or an EICR.";
    case "freeholder_email":
      return "Freeholder's email missing. If you do not have it, use the details on your lease.";
    case "correspondence_postcode":
      return "Correspondence address missing. It must be in England or Wales, and cannot be a PO box.";
    case "households":
      return "Number of households not known. A Household Pulse check-in can ask your tenant.";
    case "occupants":
      return "Number of occupants not known. A Household Pulse check-in can ask your tenant.";
    case "companies_house_number":
      return "Company number missing. Without it you will have to enter every director's details.";
    default:
      return `Not answered yet: ${field.question}`;
  }
}
