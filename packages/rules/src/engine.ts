import { CURRENT_TIMETABLE, timetableFor, type RegionTimetable } from "./data/timetable.js";
import { addDays, addMonths, daysBetween, formatUkLong, isAfter, isOnOrAfter } from "./dates.js";
import { buildFactBag, evaluatePredicate } from "./predicate.js";
import type {
  ComplianceDocument,
  EvaluationInput,
  Obligation,
  ObligationState,
  Rule,
} from "./types.js";

export type EngineOptions = {
  timetable?: RegionTimetable;
  /** Days before due_on at which an obligation becomes "due soon". */
  dueSoonDays?: number;
  /** When false, unverified rules are excluded (the end-user default). */
  includeUnverified?: boolean;
};

const DEFAULT_DUE_SOON_DAYS = 30;

/**
 * Resolve the date a rule bites for this property.
 *
 * PRS rules have no fixed effective date — it depends where the property is —
 * so they carry a resolver naming which column of the regional timetable to read.
 */
export function resolveEffectiveFrom(
  rule: Rule,
  input: EvaluationInput,
  timetable: RegionTimetable = CURRENT_TIMETABLE,
): string | null {
  if (rule.effective_resolver) {
    const entry = timetableFor(input.property.itl1_region, timetable);
    return rule.effective_resolver === "prs_region_commencement"
      ? entry.commences_on
      : entry.deadline_on;
  }
  return rule.effective_from;
}

/**
 * The date a duty starts to bite for this property.
 *
 * This is deliberately NOT the same as the due date. A registration duty begins
 * at the region's commencement date and falls due at the region's deadline; if
 * we treated the deadline as the start, the obligation would read "not yet
 * applicable" for the whole three-month window the landlord is meant to act in.
 */
function resolveAppliesFrom(
  rule: Rule,
  input: EvaluationInput,
  timetable: RegionTimetable,
): string | null {
  if (rule.effective_resolver) {
    return timetableFor(input.property.itl1_region, timetable).commences_on;
  }
  return rule.effective_from;
}

function latestConfirmed(
  documents: ComplianceDocument[],
  kinds: string[],
): ComplianceDocument | null {
  const matches = documents
    .filter((d) => kinds.includes(d.kind) && d.confirmed_at !== null)
    .sort((a, b) => (a.issued_on ?? "").localeCompare(b.issued_on ?? ""));
  return matches.at(-1) ?? null;
}

/**
 * Work out when a document-holding obligation next falls due.
 *
 * We prefer the expiry the document itself states (an EICR can require an
 * earlier re-inspection than the statutory maximum), and fall back to the
 * statutory cadence from the issue date.
 */
function documentDueDate(
  doc: ComplianceDocument | null,
  everyMonths: number | undefined,
): string | null {
  if (!doc) return null;
  if (doc.expires_on) return doc.expires_on;
  if (doc.issued_on && everyMonths) return addMonths(doc.issued_on, everyMonths);
  return null;
}

function stateFor(
  today: string,
  dueOn: string | null,
  satisfied: boolean,
  appliesFrom: string | null,
  dueSoonDays: number,
  inBreachNow: boolean,
): ObligationState {
  if (appliesFrom && isAfter(appliesFrom, today)) {
    // The duty has not started for this property yet.
    return satisfied ? "satisfied" : "not_yet_applicable";
  }
  if (satisfied) return "satisfied";
  // A duty that is already in force with nothing on file is a breach today,
  // not something pleasantly ahead of us.
  if (inBreachNow) return "overdue";
  if (!dueOn) return "upcoming";
  const remaining = daysBetween(today, dueOn);
  if (remaining < 0) return "overdue";
  if (remaining <= dueSoonDays) return "due_soon";
  return "upcoming";
}

/**
 * Derive the due date and satisfaction for one rule.
 *
 * Each branch is deliberately explicit rather than generic: the rules genuinely
 * differ, and a clever abstraction here would hide the bit that has to be right.
 */
function deriveObligation(
  rule: Rule,
  input: EvaluationInput,
  /** Regional deadline for PRS duties; the rule's own date otherwise. */
  dueAnchor: string | null,
): {
  dueOn: string | null;
  satisfied: boolean;
  satisfiedBy: string | null;
  reason: string;
  /** True when the duty is in force and demonstrably unmet right now. */
  inBreachNow?: boolean;
} {
  const { documents, tenancy, registration, landlord, today } = input;
  const cadence = rule.obligation.cadence;

  switch (rule.id) {
    case "PRS-REG-LANDLORD": {
      const satisfied = landlord.landlord_registration_number !== null;
      return {
        dueOn: dueAnchor,
        satisfied,
        satisfiedBy: landlord.landlord_registration_number,
        reason: satisfied
          ? `Landlord entry recorded${landlord.registered_on ? ` on ${formatUkLong(landlord.registered_on)}` : ""}.`
          : "No landlord registration number recorded yet.",
      };
    }

    case "PRS-REG-DWELLING": {
      const satisfied = registration.status === "active";
      return {
        dueOn: dueAnchor,
        satisfied,
        satisfiedBy: registration.property_registration_number,
        reason: satisfied
          ? "Dwelling entry is active."
          : registration.status === "lapsed" || registration.status === "inactive"
            ? "The dwelling entry is no longer active — it needs renewing."
            : "No dwelling entry recorded for this property yet.",
      };
    }

    case "PRS-RENEW-ANNUAL": {
      const dueOn = registration.renewal_due_on;
      const satisfied = dueOn !== null && isAfter(dueOn, addDays(today, 30));
      return {
        dueOn,
        satisfied,
        satisfiedBy: null,
        reason: dueOn
          ? `Entry renews on ${formatUkLong(dueOn)}. Renewal is manual — the government will not take it automatically.`
          : "Renewal date will be set once the first dwelling entry is recorded.",
      };
    }

    case "PRS-GAS-UPLOAD": {
      const gas = latestConfirmed(documents, ["gas_safety_record"]);
      if (!gas?.issued_on) {
        return {
          dueOn: null,
          satisfied: false,
          satisfiedBy: null,
          reason: "No gas safety record on file to upload.",
        };
      }
      const dueOn = addDays(gas.issued_on, cadence?.within_days ?? 28);
      // Satisfaction is proven by a closed drift item, tracked outside the engine.
      return {
        dueOn,
        satisfied: registration.status !== "active",
        satisfiedBy: gas.id,
        reason:
          registration.status === "active"
            ? `Gas record issued ${formatUkLong(gas.issued_on)} must be on your database entry by ${formatUkLong(dueOn)}.`
            : "Not applicable until the dwelling entry is active.",
      };
    }

    case "GAS-ANNUAL": {
      const gas = latestConfirmed(documents, ["gas_safety_record"]);
      const dueOn = documentDueDate(gas, cadence?.every_months ?? 12);
      const satisfied = dueOn !== null && isOnOrAfter(dueOn, today);
      return {
        dueOn,
        satisfied,
        satisfiedBy: gas?.id ?? null,
        reason: !gas
          ? "No gas safety record on file."
          : satisfied
            ? `Gas safety record valid until ${formatUkLong(dueOn!)}.`
            : `Gas safety record expired on ${formatUkLong(dueOn!)}.`,
        inBreachNow: !gas,
      };
    }

    case "ELEC-5Y": {
      const eicr = latestConfirmed(documents, ["eicr", "eic"]);
      const dueOn = documentDueDate(eicr, cadence?.every_months ?? 60);
      const satisfied = dueOn !== null && isOnOrAfter(dueOn, today);
      return {
        dueOn,
        satisfied,
        satisfiedBy: eicr?.id ?? null,
        reason: !eicr
          ? "No electrical installation condition report on file."
          : satisfied
            ? `Electrical report valid until ${formatUkLong(dueOn!)}.`
            : `Electrical report expired on ${formatUkLong(dueOn!)}.`,
        inBreachNow: !eicr,
      };
    }

    case "ELEC-REMEDIAL-28D": {
      const eicr = latestConfirmed(documents, ["eicr"]);
      if (!eicr || eicr.outcome !== "unsatisfactory" || !eicr.issued_on) {
        return { dueOn: null, satisfied: true, satisfiedBy: null, reason: "No unsatisfactory report outstanding." };
      }
      const dueOn = addDays(eicr.issued_on, cadence?.within_days ?? 28);
      return {
        dueOn,
        satisfied: false,
        satisfiedBy: null,
        reason: `The report dated ${formatUkLong(eicr.issued_on)} was unsatisfactory. Remedial work is due by ${formatUkLong(dueOn)}.`,
      };
    }

    case "EPC-VALID": {
      const epc = latestConfirmed(documents, ["epc"]);
      const dueOn = documentDueDate(epc, cadence?.every_months ?? 120);
      const inDate = dueOn !== null && isOnOrAfter(dueOn, today);
      const rating = epc?.epc_rating ?? null;
      const ratingOk = rating !== null && rating <= "E";
      return {
        dueOn,
        satisfied: inDate && ratingOk,
        satisfiedBy: epc?.id ?? null,
        reason: !epc
          ? "No EPC on file."
          : !inDate
            ? `EPC expired on ${formatUkLong(dueOn!)}.`
            : !ratingOk
              ? `EPC rating ${rating} is below the minimum of E. You need an exemption or improvements.`
              : `EPC rating ${rating}, valid until ${formatUkLong(dueOn!)}.`,
        inBreachNow: !epc || !ratingOk,
      };
    }

    case "LICENSING": {
      const expires = input.property.licence_expires_on;
      const satisfied = expires !== null && isOnOrAfter(expires, today);
      return {
        dueOn: expires,
        satisfied,
        satisfiedBy: null,
        reason: !expires
          ? "You have told us a licence is needed, but none is recorded."
          : satisfied
            ? `Licence valid until ${formatUkLong(expires!)}.`
            : `Licence expired on ${formatUkLong(expires!)}.`,
        inBreachNow: !expires,
      };
    }

    case "DEPOSIT-30D": {
      if (!tenancy) return { dueOn: null, satisfied: true, satisfiedBy: null, reason: "No current tenancy." };
      const dueOn = addDays(tenancy.started_on, cadence?.within_days ?? 30);
      const protectedOk = tenancy.deposit_protected_on !== null;
      const infoOk = tenancy.prescribed_information_served_on !== null;
      return {
        dueOn,
        satisfied: protectedOk && infoOk,
        satisfiedBy: null,
        reason: protectedOk && infoOk
          ? `Deposit protected on ${formatUkLong(tenancy.deposit_protected_on!)} and prescribed information served.`
          : !protectedOk
            ? "Deposit is not recorded as protected in a scheme."
            : "Deposit is protected but the prescribed information is not recorded as served.",
        inBreachNow: false,
      };
    }

    case "RIGHT-TO-RENT": {
      if (!tenancy) return { dueOn: null, satisfied: true, satisfiedBy: null, reason: "No current tenancy." };
      const followUp = tenancy.right_to_rent_follow_up_on;
      const done = tenancy.right_to_rent_checked_on !== null;
      const dueOn = followUp ?? (done ? null : tenancy.started_on);
      const satisfied = done && (followUp === null || isOnOrAfter(followUp, today));
      return {
        dueOn,
        satisfied,
        satisfiedBy: null,
        reason: !done
          ? "No right to rent check recorded."
          : followUp
            ? `Follow-up check due by ${formatUkLong(followUp)}.`
            : `Checked on ${formatUkLong(tenancy.right_to_rent_checked_on!)}.`,
        inBreachNow: !done,
      };
    }

    case "ALARMS": {
      if (!tenancy) return { dueOn: null, satisfied: true, satisfiedBy: null, reason: "No current tenancy." };
      const tested = tenancy.alarms_tested_on !== null;
      return {
        dueOn: tenancy.started_on,
        satisfied: tested,
        satisfiedBy: null,
        reason: tested
          ? `Alarms recorded as tested on ${formatUkLong(tenancy.alarms_tested_on!)}.`
          : "No record that the alarms were tested on the first day of the tenancy.",
        inBreachNow: !tested,
      };
    }

    case "ICO-FEE":
    case "LEGIONELLA": {
      return {
        dueOn: null,
        satisfied: false,
        satisfiedBy: null,
        reason: rule.summary,
      };
    }

    default: {
      // Informational and shell rules: surface them, do not date them.
      return { dueOn: null, satisfied: false, satisfiedBy: null, reason: rule.summary };
    }
  }
}

/**
 * The core pure function.
 * (property, tenancy, documents, registrations, today) -> obligations[]
 */
export function evaluate(
  input: EvaluationInput,
  corpus: Rule[],
  options: EngineOptions = {},
): Obligation[] {
  const timetable = options.timetable ?? CURRENT_TIMETABLE;
  const dueSoonDays = options.dueSoonDays ?? DEFAULT_DUE_SOON_DAYS;
  const includeUnverified = options.includeUnverified ?? false;

  const bag = buildFactBag(input);
  const obligations: Obligation[] = [];

  for (const rule of corpus) {
    if (!includeUnverified && rule.verification_status === "unverified") continue;
    if (rule.informational) continue;
    if (!evaluatePredicate(rule.applies_when, bag, rule.id)) continue;

    const dueAnchor = resolveEffectiveFrom(rule, input, timetable);
    const appliesFrom = resolveAppliesFrom(rule, input, timetable);
    const { dueOn, satisfied, satisfiedBy, reason, inBreachNow } = deriveObligation(rule, input, dueAnchor);
    const state = stateFor(input.today, dueOn, satisfied, appliesFrom, dueSoonDays, inBreachNow ?? false);

    obligations.push({
      rule_id: rule.id,
      rule_version: rule.version,
      property_id: input.property.id,
      title: rule.title,
      summary: rule.summary,
      kind: rule.obligation.kind,
      due_on: dueOn,
      state,
      days_remaining: dueOn ? daysBetween(input.today, dueOn) : null,
      satisfied_by: satisfiedBy,
      reason,
      sources: rule.sources,
      verification_status: rule.verification_status,
      status: rule.status,
      ...(rule.consequence_pennies_max !== undefined
        ? { consequence_pennies_max: rule.consequence_pennies_max }
        : {}),
    });
  }

  return sortByUrgency(obligations);
}

const STATE_ORDER: Record<ObligationState, number> = {
  overdue: 0,
  due_soon: 1,
  blocked: 2,
  upcoming: 3,
  not_yet_applicable: 4,
  satisfied: 5,
};

/** Dashboard ordering: most urgent first, then soonest due. */
export function sortByUrgency(obligations: Obligation[]): Obligation[] {
  return [...obligations].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.due_on && b.due_on) return a.due_on.localeCompare(b.due_on);
    if (a.due_on) return -1;
    if (b.due_on) return 1;
    return a.rule_id.localeCompare(b.rule_id);
  });
}

/**
 * Maximum theoretical civil penalty exposure across currently-breached rules.
 *
 * This is deliberately conservative: only breached (overdue) obligations count,
 * each rule counts once per property, and we only use figures we have a source
 * for. It is a sober ceiling, not a prediction.
 */
export function exposurePennies(obligations: Obligation[]): bigint {
  return obligations
    .filter((o) => o.state === "overdue" && o.consequence_pennies_max !== undefined)
    .reduce((sum, o) => sum + (o.consequence_pennies_max ?? 0n), 0n);
}

/** The single "next best action" for the dashboard. */
export function nextBestAction(obligations: Obligation[]): Obligation | null {
  return sortByUrgency(obligations).find((o) => o.state !== "satisfied" && o.state !== "not_yet_applicable") ?? null;
}
