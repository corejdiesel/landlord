import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, addYears, daysBetween, daysRemaining, formatUkLong, formatUkShort,
  fromEpochDay, InvalidDateError, isAfter, isBefore, isLeapYear, isOnOrAfter, isOnOrBefore,
  isValidIsoDate, londonDateOf, maxDate, minDate, parseIsoDate, toEpochDay,
} from "../src/dates.js";

describe("parsing and validation", () => {
  it("parses a well-formed date", () => {
    expect(parseIsoDate("2027-03-14")).toEqual({ year: 2027, month: 3, day: 14 });
  });

  it.each(["2027-3-14", "14/03/2027", "2027-13-01", "2027-02-30", "", "not-a-date", "2027-00-10"])(
    "rejects %s",
    (bad) => {
      expect(() => parseIsoDate(bad)).toThrow(InvalidDateError);
      expect(isValidIsoDate(bad)).toBe(false);
    },
  );

  it("accepts 29 February in a leap year and rejects it otherwise", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
  });
});

describe("leap years", () => {
  it.each([
    [2024, true], [2027, false], [2028, true],
    [1900, false], [2000, true], [2100, false], [2400, true],
  ])("year %i -> %s", (year, expected) => {
    expect(isLeapYear(year)).toBe(expected);
  });
});

describe("epoch day round trip", () => {
  it("anchors on the unix epoch", () => {
    expect(toEpochDay("1970-01-01")).toBe(0);
    expect(fromEpochDay(0)).toBe("1970-01-01");
  });

  it("round-trips across a wide range including leap days and century boundaries", () => {
    const samples = [
      "1900-01-01", "1970-01-01", "1999-12-31", "2000-02-29", "2024-02-29",
      "2026-12-15", "2027-03-14", "2028-02-29", "2100-03-01", "2400-02-29",
    ];
    for (const s of samples) expect(fromEpochDay(toEpochDay(s))).toBe(s);
  });

  it("round-trips every day across a four-year leap cycle", () => {
    let day = toEpochDay("2024-01-01");
    const end = toEpochDay("2028-12-31");
    for (; day <= end; day++) {
      expect(toEpochDay(fromEpochDay(day))).toBe(day);
    }
  });
});

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
    expect(addDays("2027-01-31", 1)).toBe("2027-02-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles the 28-day drift window off a leap day", () => {
    expect(addDays("2028-02-29", 28)).toBe("2028-03-28");
  });

  it("is unaffected by the BST transition", () => {
    // Clocks go forward on 29 March 2026 and back on 25 October 2026.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(daysBetween("2026-03-01", "2026-11-01")).toBe(245);
  });
});

describe("addMonths clamps to month end", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-05-31", 1, "2026-06-30"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2026-06-15", 12, "2027-06-15"],
    ["2026-06-15", -6, "2025-12-15"],
  ])("%s + %i months -> %s", (from, months, expected) => {
    expect(addMonths(from, months)).toBe(expected);
  });

  it("is not always reversible when it clamps, which is intended", () => {
    const forward = addMonths("2026-01-31", 1); // 2026-02-28
    expect(addMonths(forward, -1)).toBe("2026-01-28");
  });
});

describe("addYears", () => {
  it("clamps a leap day to 28 February in a common year", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2028-02-29", 4)).toBe("2032-02-29");
  });

  it("handles the ordinary annual renewal case", () => {
    expect(addYears("2026-12-15", 1)).toBe("2027-12-15");
  });
});

describe("comparison and selection", () => {
  it("orders dates", () => {
    expect(isBefore("2026-01-01", "2026-01-02")).toBe(true);
    expect(isAfter("2026-01-02", "2026-01-01")).toBe(true);
    expect(isOnOrBefore("2026-01-01", "2026-01-01")).toBe(true);
    expect(isOnOrAfter("2026-01-01", "2026-01-01")).toBe(true);
    expect(isBefore("2026-01-01", "2026-01-01")).toBe(false);
  });

  it("picks min and max, ignoring nulls", () => {
    expect(minDate("2027-03-14", null, "2026-12-15")).toBe("2026-12-15");
    expect(maxDate("2027-03-14", null, "2026-12-15")).toBe("2027-03-14");
    expect(minDate(null, null)).toBeNull();
    expect(maxDate()).toBeNull();
  });
});

describe("daysRemaining treats the due date as inclusive", () => {
  it("is 0 on the due date, so the landlord is still in time", () => {
    expect(daysRemaining("2027-03-14", "2027-03-14")).toBe(0);
  });

  it("is negative once the deadline has passed", () => {
    expect(daysRemaining("2027-03-15", "2027-03-14")).toBe(-1);
  });

  it("counts the West Midlands window correctly", () => {
    expect(daysRemaining("2026-12-15", "2027-03-14")).toBe(89);
  });
});

describe("UK formatting", () => {
  it("renders long form", () => {
    expect(formatUkLong("2027-03-14")).toBe("14 March 2027");
    expect(formatUkLong("2026-12-15")).toBe("15 December 2026");
  });

  it("renders short form", () => {
    expect(formatUkShort("2027-03-14")).toBe("14 Mar 2027");
  });
});

describe("londonDateOf", () => {
  it("uses the London calendar date, not UTC, during BST", () => {
    // 23:30 UTC on 30 June is already 1 July in London (BST is UTC+1).
    expect(londonDateOf(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });

  it("agrees with UTC in winter", () => {
    expect(londonDateOf(new Date("2026-12-15T23:30:00Z"))).toBe("2026-12-15");
  });
});
