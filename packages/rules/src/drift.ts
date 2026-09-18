import { addDays, daysBetween } from "./dates.js";

/**
 * The 28-Day Drift Clock.
 *
 * Once a property is registered we hold a snapshot of what we believe the
 * GOV.UK entry says. Any change to a registered fact opens a drift item with a
 * 28-day countdown to update the entry.
 *
 * Two things this deliberately does NOT do:
 *
 *  1. It does not diff our own previous state against our current state. It
 *     diffs the *snapshot of the government entry* against our current state.
 *     Those are different: a landlord can change something here twice before
 *     updating GOV.UK once, and only the first change should start a clock.
 *
 *  2. It does not close an item when the value changes back. If the entry said
 *     £1,200 and the rent went to £1,250 and back to £1,200, the entry is
 *     correct again — but that is a judgement about the government's record, so
 *     `reconcile` reports it as resolvable rather than silently closing it.
 */

/** Registered facts, as the register holds them. Flat and comparable. */
export type RegisteredFacts = {
  rent_pennies?: string;
  rent_frequency?: string;
  bills_included?: boolean;
  households?: number;
  occupants?: number;
  bedrooms?: number;
  furnished?: string;
  has_gas?: boolean;
  gas_certificate_issued_on?: string | null;
  licence_kind?: string;
  licence_number?: string | null;
  property_manager_name?: string | null;
  property_manager_email?: string | null;
  freeholder_name?: string | null;
  freeholder_email?: string | null;
  superior_landlord_name?: string | null;
  epc_certificate_number?: string | null;
  correspondence_postcode?: string | null;
};

export type DriftField = keyof RegisteredFacts;

/** Field labels, in the landlord's language rather than ours. */
export const DRIFT_FIELD_LABELS: Record<DriftField, string> = {
  rent_pennies: "Rent",
  rent_frequency: "How often rent is paid",
  bills_included: "Whether bills are included",
  households: "Number of households",
  occupants: "Number of occupants",
  bedrooms: "Number of bedrooms",
  furnished: "Furnished or not",
  has_gas: "Gas supply or appliances",
  gas_certificate_issued_on: "Gas safety record",
  licence_kind: "Licence type",
  licence_number: "Licence number",
  property_manager_name: "Property manager",
  property_manager_email: "Property manager's email",
  freeholder_name: "Freeholder",
  freeholder_email: "Freeholder's email",
  superior_landlord_name: "Superior landlord",
  epc_certificate_number: "EPC",
  correspondence_postcode: "Correspondence address",
};

/** Days to update the register after a fact goes out of date. */
export const DRIFT_WINDOW_DAYS = 28;

/** Escalating reminders, in days before the due date. */
export const DRIFT_REMINDER_DAYS = [14, 7, 3, 1] as const;

export type DriftDiff = {
  field: DriftField;
  field_label: string;
  /** What we believe the government entry currently says. */
  old_value: string | null;
  /** What our records now say. */
  new_value: string | null;
};

function normalise(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

/**
 * Compare the register snapshot against current facts.
 *
 * Only fields present in the snapshot are compared: a field the register does
 * not hold cannot drift, and a field we have not recorded yet should not look
 * like a change to an empty value.
 */
export function diffRegisteredFacts(
  snapshot: RegisteredFacts,
  current: RegisteredFacts,
): DriftDiff[] {
  const diffs: DriftDiff[] = [];

  for (const key of Object.keys(snapshot) as DriftField[]) {
    if (!(key in current)) continue;
    const before = normalise(snapshot[key]);
    const after = normalise(current[key]);
    if (before === after) continue;
    diffs.push({
      field: key,
      field_label: DRIFT_FIELD_LABELS[key] ?? key,
      old_value: before,
      new_value: after,
    });
  }

  return diffs;
}

export type OpenDriftItem = {
  field: DriftField;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  opened_on: string;
  due_on: string;
};

/** Open a drift item for each changed field, dated from when it changed. */
export function openDriftItems(diffs: DriftDiff[], changedOn: string): OpenDriftItem[] {
  return diffs.map((d) => ({
    ...d,
    opened_on: changedOn,
    due_on: addDays(changedOn, DRIFT_WINDOW_DAYS),
  }));
}

export type DriftState = "open" | "due_soon" | "overdue" | "closed";

export type DriftStatus = {
  state: DriftState;
  days_remaining: number;
  /** Plain sentence, ready to render. */
  message: string;
};

export function driftStatus(item: { due_on: string; closed_at?: string | null }, today: string): DriftStatus {
  if (item.closed_at) {
    return { state: "closed", days_remaining: 0, message: "You have told us this is updated on GOV.UK." };
  }
  const remaining = daysBetween(today, item.due_on);
  if (remaining < 0) {
    return {
      state: "overdue",
      days_remaining: remaining,
      message:
        `Your GOV.UK entry has been out of date since ${item.due_on}. ` +
        `Update it as soon as you can.`,
    };
  }
  if (remaining <= 7) {
    return {
      state: "due_soon",
      days_remaining: remaining,
      message: remaining === 0
        ? "Your GOV.UK entry must be updated today."
        : `Your GOV.UK entry is out of date. Update it within ${remaining} day${remaining === 1 ? "" : "s"}.`,
    };
  }
  return {
    state: "open",
    days_remaining: remaining,
    message: `Your GOV.UK entry is now out of date. Update it by ${item.due_on}.`,
  };
}

/** Which reminders are due for an open drift item, as ISO dates. */
export function driftReminderDates(dueOn: string): string[] {
  return DRIFT_REMINDER_DAYS.map((d) => addDays(dueOn, -d));
}

/**
 * Advance the snapshot after the landlord confirms they updated GOV.UK.
 *
 * Only the fields that had open drift items move. A field that changed after
 * the landlord started updating should keep its own, later clock rather than
 * being swept up in this confirmation.
 */
export function advanceSnapshot(
  snapshot: RegisteredFacts,
  current: RegisteredFacts,
  confirmedFields: DriftField[],
): RegisteredFacts {
  const next: RegisteredFacts = { ...snapshot };
  for (const field of confirmedFields) {
    if (field in current) {
      (next as Record<string, unknown>)[field] = current[field];
    }
  }
  return next;
}

/**
 * Find open drift items whose value has returned to what the register says.
 *
 * Reported rather than auto-closed: whether the entry is now correct is a
 * statement about the government's record, and only the landlord can confirm it.
 */
export function resolvableDriftItems(
  snapshot: RegisteredFacts,
  current: RegisteredFacts,
  openItems: { field: DriftField }[],
): DriftField[] {
  return openItems
    .filter(({ field }) => {
      if (!(field in snapshot) || !(field in current)) return false;
      return normalise(snapshot[field]) === normalise(current[field]);
    })
    .map((i) => i.field);
}
