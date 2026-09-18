import { describe, expect, it } from "vitest";
import { portfolioRadar, radarFor, synchronisedRenewalDate } from "../src/radar.js";
import { annualCostPennies, CURRENT_FEES } from "../src/data/fees.js";
import { CURRENT_TIMETABLE, timetableFor } from "../src/data/timetable.js";
import { parsePostcode, regionFromPostcodeFallback } from "../src/data/postcode-regions.js";
import { ITL1_REGIONS, REGION_LABELS } from "../src/types.js";
import { daysBetween, isAfter } from "../src/dates.js";

describe("region timetable", () => {
  it("covers all nine ITL1 regions exactly once", () => {
    expect(CURRENT_TIMETABLE.entries).toHaveLength(9);
    const regions = CURRENT_TIMETABLE.entries.map((e) => e.region);
    expect(new Set(regions).size).toBe(9);
    for (const r of ITL1_REGIONS) expect(regions).toContain(r);
  });

  it("gives every region a deadline after its commencement", () => {
    for (const e of CURRENT_TIMETABLE.entries) {
      expect(isAfter(e.deadline_on, e.commences_on)).toBe(true);
    }
  });

  it("gives every region roughly a three-month window", () => {
    for (const e of CURRENT_TIMETABLE.entries) {
      // 88 days is the East Midlands window, which spans February.
      const days = daysBetween(e.commences_on, e.deadline_on);
      expect(days, e.region).toBeGreaterThanOrEqual(88);
      expect(days, e.region).toBeLessThanOrEqual(92);
    }
  });

  it("starts with the West Midlands on 15 December 2026", () => {
    const wm = timetableFor("west_midlands");
    expect(wm.commences_on).toBe("2026-12-15");
    expect(wm.deadline_on).toBe("2027-03-14");
  });

  it("is labelled as secondary-sourced, not primary", () => {
    expect(CURRENT_TIMETABLE.verification_status).toBe("verified_secondary");
    expect(CURRENT_TIMETABLE.sources.length).toBeGreaterThan(0);
  });

  it("has a label for every region", () => {
    for (const r of ITL1_REGIONS) expect(REGION_LABELS[r]).toBeTruthy();
  });

  it("throws rather than guessing for an unknown region", () => {
    // @ts-expect-error deliberately invalid region
    expect(() => timetableFor("atlantis")).toThrow();
  });
});

describe("radarFor", () => {
  it("counts down to an unopened window", () => {
    const r = radarFor("west_midlands", "2026-09-18");
    expect(r.state).toBe("not_open_yet");
    expect(r.days_until_open).toBe(88);
    expect(r.headline).toBe("Registration opens for you in 88 days.");
  });

  it("uses singular phrasing the day before opening", () => {
    expect(radarFor("west_midlands", "2026-12-14").headline).toBe("Registration opens for you tomorrow.");
  });

  it("switches to open on the commencement date itself", () => {
    const r = radarFor("west_midlands", "2026-12-15");
    expect(r.state).toBe("open_now");
    expect(r.days_until_deadline).toBe(89);
    expect(r.headline).toContain("89 days to register");
  });

  it("is still open on the deadline day", () => {
    const r = radarFor("west_midlands", "2027-03-14");
    expect(r.state).toBe("open_now");
    expect(r.days_until_deadline).toBe(0);
    expect(r.headline).toBe("Your deadline is today.");
  });

  it("reports a passed deadline in long UK format", () => {
    const r = radarFor("west_midlands", "2027-03-15");
    expect(r.state).toBe("deadline_passed");
    expect(r.headline).toBe("Your deadline passed on 14 March 2027.");
  });

  it("gives London the latest window of the nine regions", () => {
    const london = radarFor("london", "2026-09-18");
    expect(london.deadline_on).toBe("2027-10-14");
    for (const r of ITL1_REGIONS) {
      if (r === "south_west") continue;
      expect(radarFor(r, "2026-09-18").deadline_on <= "2027-11-14").toBe(true);
    }
  });
});

describe("portfolioRadar", () => {
  const today = "2026-09-18";

  it("groups properties by region and orders by deadline", () => {
    const p = portfolioRadar(
      [
        { postcode: "SW1A 1AA", region: "london" },
        { postcode: "B1 1AA", region: "west_midlands" },
        { postcode: "B2 2BB", region: "west_midlands" },
      ],
      today,
    );
    expect(p.entries).toHaveLength(2);
    expect(p.entries[0]!.region).toBe("west_midlands");
    expect(p.entries[0]!.postcodes).toEqual(["B1 1AA", "B2 2BB"]);
    expect(p.entries[1]!.region).toBe("london");
  });

  it("reports the earliest deadline, because that is the one that bites first", () => {
    const p = portfolioRadar(
      [
        { postcode: "SW1A 1AA", region: "london" },
        { postcode: "B1 1AA", region: "west_midlands" },
      ],
      today,
    );
    expect(p.first_deadline_on).toBe("2027-03-14");
  });

  it("costs £65 per property per year", () => {
    const p = portfolioRadar(
      [
        { postcode: "B1 1AA", region: "west_midlands" },
        { postcode: "B2 2BB", region: "west_midlands" },
        { postcode: "SW1A 1AA", region: "london" },
      ],
      today,
    );
    expect(p.property_count).toBe(3);
    expect(p.annual_cost_pennies).toBe(19500n);
  });

  it("handles an empty portfolio without inventing a deadline", () => {
    const p = portfolioRadar([], today);
    expect(p.entries).toEqual([]);
    expect(p.first_deadline_on).toBeNull();
    expect(p.annual_cost_pennies).toBe(0n);
  });
});

describe("fees", () => {
  it("prices the dwelling entry at £65 and the landlord entry free", () => {
    expect(CURRENT_FEES.dwelling_entry_pennies).toBe(6500n);
    expect(CURRENT_FEES.landlord_entry_pennies).toBe(0n);
  });

  it("scales linearly and stays exact in pennies", () => {
    expect(annualCostPennies(0)).toBe(0n);
    expect(annualCostPennies(1)).toBe(6500n);
    expect(annualCostPennies(15)).toBe(97500n);
    expect(annualCostPennies(1000)).toBe(6500000n);
  });

  it("rejects a nonsensical property count rather than returning a wrong price", () => {
    expect(() => annualCostPennies(-1)).toThrow();
    expect(() => annualCostPennies(1.5)).toThrow();
  });
});

describe("synchronised renewal dates", () => {
  it("lands on the next anniversary of the first dwelling entry", () => {
    expect(synchronisedRenewalDate("2026-12-15", "2027-06-01")).toBe("2027-12-15");
  });

  it("returns the anniversary itself when today is that day", () => {
    expect(synchronisedRenewalDate("2026-12-15", "2027-12-15")).toBe("2027-12-15");
  });

  it("skips forward multiple years for a long-lapsed entry", () => {
    expect(synchronisedRenewalDate("2026-12-15", "2030-01-01")).toBe("2030-12-15");
  });

  it("clamps a 29 February anniversary to 28 February in a common year", () => {
    expect(synchronisedRenewalDate("2028-02-29", "2029-01-01")).toBe("2029-02-28");
    expect(synchronisedRenewalDate("2028-02-29", "2032-01-01")).toBe("2032-02-29");
  });
});

describe("postcode parsing", () => {
  it.each([
    ["sw1a1aa", "SW1A 1AA", "SW"],
    ["SW1A 1AA", "SW1A 1AA", "SW"],
    ["  b1  1aa ", "B1 1AA", "B"],
    ["M1-1AE", "M1 1AE", "M"],
    ["EC1A 1BB", "EC1A 1BB", "EC"],
  ])("normalises %s", (raw, normalised, area) => {
    const p = parsePostcode(raw)!;
    expect(p.normalised).toBe(normalised);
    expect(p.area).toBe(area);
  });

  it.each(["", "NOTAPOSTCODE", "12345", "SW1A", "A", "SW1A 1A", "1SW A1A"])(
    "returns null for %s rather than throwing at a public endpoint",
    (bad) => {
      expect(parsePostcode(bad)).toBeNull();
    },
  );
});

describe("bundled postcode fallback", () => {
  it.each([
    ["SW1A 1AA", "london"],
    ["B1 1AA", "west_midlands"],
    ["M1 1AE", "north_west"],
    ["LS1 1UR", "yorkshire_and_the_humber"],
    ["NE1 4ST", "north_east"],
    ["NG1 1AA", "east_midlands"],
    ["CB1 1AA", "east_of_england"],
    ["BN1 1AA", "south_east"],
    ["BS1 1AA", "south_west"],
  ] as const)("maps %s to %s", (postcode, region) => {
    expect(regionFromPostcodeFallback(postcode)!.region).toBe(region);
  });

  it("labels its answers as coming from the fallback, never as authoritative", () => {
    const r = regionFromPostcodeFallback("B1 1AA")!;
    expect(r.source).toBe("bundled_fallback");
    expect(typeof r.approximate).toBe("boolean");
  });

  it("flags postcodes that are wholly or partly outside England", () => {
    expect(regionFromPostcodeFallback("CF10 1AA")!.outside_england).toBe("wales");
    expect(regionFromPostcodeFallback("SA1 1AA")!.outside_england).toBe("wales");
    expect(regionFromPostcodeFallback("CH1 1AA")!.outside_england).toBe("mixed");
  });

  it("marks known boundary-straddling areas as approximate", () => {
    expect(regionFromPostcodeFallback("GU1 1AA")!.approximate).toBe(true);
  });

  it("returns null for an unmapped area rather than guessing a region", () => {
    expect(regionFromPostcodeFallback("ZZ1 1AA")).toBeNull();
    expect(regionFromPostcodeFallback("rubbish")).toBeNull();
  });
});
