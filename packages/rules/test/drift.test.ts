import { describe, expect, it } from "vitest";
import {
  advanceSnapshot, diffRegisteredFacts, driftReminderDates, driftStatus,
  DRIFT_FIELD_LABELS, DRIFT_WINDOW_DAYS, formatDriftValue, openDriftItems,
  resolvableDriftItems, type RegisteredFacts,
} from "../src/drift.js";

const snapshot: RegisteredFacts = {
  rent_pennies: "125000",
  rent_frequency: "monthly",
  bills_included: false,
  households: 1,
  occupants: 2,
  bedrooms: 3,
  has_gas: true,
  gas_certificate_issued_on: "2026-06-01",
  property_manager_name: null,
};

describe("diffing against the register snapshot", () => {
  it("finds nothing when everything matches", () => {
    expect(diffRegisteredFacts(snapshot, { ...snapshot })).toEqual([]);
  });

  it("finds a rent change and describes it in the landlord's language", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, rent_pennies: "130000" });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      field: "rent_pennies",
      field_label: "Rent",
      old_value: "125000",
      new_value: "130000",
    });
  });

  it("renders booleans as yes and no rather than true and false", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, bills_included: true });
    expect(diffs[0]!.old_value).toBe("no");
    expect(diffs[0]!.new_value).toBe("yes");
  });

  it("finds several changes at once", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, occupants: 3, households: 2 });
    expect(diffs.map((d) => d.field).sort()).toEqual(["households", "occupants"]);
  });

  it("treats a new gas certificate as drift", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, gas_certificate_issued_on: "2027-06-01" });
    expect(diffs[0]!.field).toBe("gas_certificate_issued_on");
  });

  it("ignores a field the register does not hold", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, licence_number: "NEW-123" });
    expect(diffs).toEqual([]);
  });

  it("ignores a field we have not recorded, rather than reporting a change to empty", () => {
    const current: RegisteredFacts = { ...snapshot };
    delete current.occupants;
    expect(diffRegisteredFacts(snapshot, current)).toEqual([]);
  });

  it("distinguishes null from a recorded empty string", () => {
    const diffs = diffRegisteredFacts(snapshot, { ...snapshot, property_manager_name: "Acme Lettings" });
    expect(diffs[0]!.old_value).toBeNull();
    expect(diffs[0]!.new_value).toBe("Acme Lettings");
  });

  it("has a human label for every field it can report", () => {
    for (const label of Object.values(DRIFT_FIELD_LABELS)) {
      expect(label).not.toMatch(/_/);
      expect(label.length).toBeGreaterThan(2);
    }
  });
});

describe("opening drift items", () => {
  it("gives each change a 28-day window from when it changed", () => {
    const items = openDriftItems(
      diffRegisteredFacts(snapshot, { ...snapshot, rent_pennies: "130000" }),
      "2027-01-17",
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.opened_on).toBe("2027-01-17");
    expect(items[0]!.due_on).toBe("2027-02-14");
  });

  it("uses the statutory 28 days, not a month", () => {
    expect(DRIFT_WINDOW_DAYS).toBe(28);
    const items = openDriftItems(
      diffRegisteredFacts(snapshot, { ...snapshot, occupants: 4 }),
      "2027-01-31",
    );
    expect(items[0]!.due_on).toBe("2027-02-28");
  });

  it("handles a window opened on a leap day", () => {
    const items = openDriftItems(
      diffRegisteredFacts(snapshot, { ...snapshot, occupants: 4 }),
      "2028-02-29",
    );
    expect(items[0]!.due_on).toBe("2028-03-28");
  });
});

describe("drift status", () => {
  const item = { due_on: "2027-02-14" };

  it("is open and calm when there is plenty of time", () => {
    const s = driftStatus(item, "2027-01-17");
    expect(s.state).toBe("open");
    expect(s.days_remaining).toBe(28);
    expect(s.message).toContain("out of date");
  });

  it("becomes due soon inside the last week", () => {
    const s = driftStatus(item, "2027-02-10");
    expect(s.state).toBe("due_soon");
    expect(s.days_remaining).toBe(4);
    expect(s.message).toContain("within 4 days");
  });

  it("uses singular phrasing for one day", () => {
    expect(driftStatus(item, "2027-02-13").message).toContain("within 1 day");
  });

  it("says today on the due date, and is still not overdue", () => {
    const s = driftStatus(item, "2027-02-14");
    expect(s.state).toBe("due_soon");
    expect(s.days_remaining).toBe(0);
    expect(s.message).toContain("today");
  });

  it("goes overdue the day after", () => {
    const s = driftStatus(item, "2027-02-15");
    expect(s.state).toBe("overdue");
    expect(s.days_remaining).toBe(-1);
  });

  it("reports a closed item as closed regardless of the date", () => {
    const s = driftStatus({ due_on: "2027-02-14", closed_at: "2027-02-01T10:00:00Z" }, "2027-06-01");
    expect(s.state).toBe("closed");
  });

  it("never uses a penalty figure to prompt action", () => {
    for (const today of ["2027-01-17", "2027-02-10", "2027-02-14", "2027-03-01"]) {
      const s = driftStatus(item, today);
      expect(s.message).not.toMatch(/£|fine|penalt|prosecut/i);
    }
  });
});

describe("reminder schedule", () => {
  it("escalates at 14, 7, 3 and 1 days before the deadline", () => {
    expect(driftReminderDates("2027-02-14")).toEqual([
      "2027-01-31", "2027-02-07", "2027-02-11", "2027-02-13",
    ]);
  });
});

describe("advancing the snapshot", () => {
  it("moves only the confirmed fields", () => {
    const current = { ...snapshot, rent_pennies: "130000", occupants: 3 };
    const next = advanceSnapshot(snapshot, current, ["rent_pennies"]);
    expect(next.rent_pennies).toBe("130000");
    // The occupants change keeps its own, later clock.
    expect(next.occupants).toBe(2);
  });

  it("does not mutate the original snapshot", () => {
    const before = JSON.stringify(snapshot);
    advanceSnapshot(snapshot, { ...snapshot, rent_pennies: "999" }, ["rent_pennies"]);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("closes the drift when the snapshot catches up", () => {
    const current = { ...snapshot, rent_pennies: "130000" };
    const next = advanceSnapshot(snapshot, current, ["rent_pennies"]);
    expect(diffRegisteredFacts(next, current)).toEqual([]);
  });

  it("ignores a confirmed field we hold no current value for", () => {
    const current: RegisteredFacts = { ...snapshot };
    delete current.rent_pennies;
    expect(advanceSnapshot(snapshot, current, ["rent_pennies"]).rent_pennies).toBe("125000");
  });
});

describe("a value that changes back", () => {
  it("is reported as resolvable rather than closed automatically", () => {
    // Rent went up, an item opened, then it went back down again.
    const current = { ...snapshot };
    const resolvable = resolvableDriftItems(snapshot, current, [{ field: "rent_pennies" }]);
    expect(resolvable).toEqual(["rent_pennies"]);
  });

  it("does not report an item whose value still differs", () => {
    const current = { ...snapshot, rent_pennies: "130000" };
    expect(resolvableDriftItems(snapshot, current, [{ field: "rent_pennies" }])).toEqual([]);
  });
});

describe("the snapshot is the government's record, not our history", () => {
  it("does not open a second item when a fact changes twice before confirmation", () => {
    // The register says 125000. Rent goes to 130000, then to 135000, with no
    // GOV.UK update in between. That is still one thing to fix, not two.
    const afterFirst = diffRegisteredFacts(snapshot, { ...snapshot, rent_pennies: "130000" });
    const afterSecond = diffRegisteredFacts(snapshot, { ...snapshot, rent_pennies: "135000" });
    expect(afterFirst).toHaveLength(1);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]!.old_value).toBe("125000");
    expect(afterSecond[0]!.new_value).toBe("135000");
  });
});

describe("rendering drift values for a human", () => {
  it("renders rent pennies as pounds, not as a raw integer", () => {
    // This is the bug it exists for: "260000" told a landlord their rent was
    // two hundred and sixty thousand pounds.
    expect(formatDriftValue("rent_pennies", "260000")).toBe("£2,600");
    expect(formatDriftValue("rent_pennies", "125050")).toBe("£1,250.50");
    expect(formatDriftValue("rent_pennies", "0")).toBe("£0");
  });

  it("renders a certificate date in long UK form", () => {
    expect(formatDriftValue("gas_certificate_issued_on", "2026-10-05")).toBe("5 October 2026");
  });

  it("renders booleans as Yes and No", () => {
    expect(formatDriftValue("bills_included", "yes")).toBe("Yes");
    expect(formatDriftValue("has_gas", "no")).toBe("No");
  });

  it("removes snake_case from enum values", () => {
    expect(formatDriftValue("rent_frequency", "four_weekly")).toBe("four weekly");
    expect(formatDriftValue("licence_kind", "hmo_mandatory")).toBe("hmo mandatory");
  });

  it("says 'not set' rather than showing an empty gap", () => {
    expect(formatDriftValue("property_manager_name", null)).toBe("not set");
    expect(formatDriftValue("property_manager_name", "")).toBe("not set");
  });

  it("passes plain text through unchanged", () => {
    expect(formatDriftValue("property_manager_name", "Acme Lettings")).toBe("Acme Lettings");
  });
});

describe("drift messages read as English", () => {
  it("uses long UK dates, never ISO", () => {
    for (const today of ["2027-01-17", "2027-02-10", "2027-02-14", "2027-03-01"]) {
      expect(driftStatus({ due_on: "2027-02-14" }, today).message).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});
