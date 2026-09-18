import type { Itl1Region, RuleSource } from "../types.js";

/**
 * PRS Database regional rollout timetable.
 *
 * Held as versioned data, never as constants in logic: the draft regulations
 * are expected to change before commencement, and we want a changed date to be
 * a data edit with a new version, not a code change.
 *
 * SOURCE STATUS: secondary. Taken from the spec's reading of the draft Private
 * Rented Sector Database Regulations 2026 and GOV.UK Housing Hub. Must be
 * confirmed against the made regulations before launch.
 */

export type RegionTimetableEntry = {
  region: Itl1Region;
  /** ISO date the regulations commence for this region. */
  commences_on: string;
  /** ISO date by which a dwelling entry must be active. Inclusive. */
  deadline_on: string;
};

export type RegionTimetable = {
  version: number;
  /** ISO date this version of the table was compiled. */
  compiled_on: string;
  verification_status: "verified_primary" | "verified_secondary" | "unverified";
  sources: RuleSource[];
  entries: RegionTimetableEntry[];
};

const SOURCES: RuleSource[] = [
  {
    label: "GOV.UK Housing Hub — Get ready to register",
    url: "https://housinghub.campaign.gov.uk/renting-is-changing/get-ready-to-register/",
    checked_on: "2026-09-18",
  },
  {
    label: "Draft Private Rented Sector Database Regulations 2026",
    url: "https://www.legislation.gov.uk/ukdsi/2026/9780348286861/data.pdf",
    checked_on: "2026-09-18",
  },
];

export const REGION_TIMETABLE_V1: RegionTimetable = {
  version: 1,
  compiled_on: "2026-09-18",
  verification_status: "verified_secondary",
  sources: SOURCES,
  entries: [
    { region: "west_midlands", commences_on: "2026-12-15", deadline_on: "2027-03-14" },
    { region: "east_of_england", commences_on: "2027-01-15", deadline_on: "2027-04-14" },
    { region: "east_midlands", commences_on: "2027-02-15", deadline_on: "2027-05-14" },
    { region: "south_east", commences_on: "2027-03-15", deadline_on: "2027-06-14" },
    { region: "yorkshire_and_the_humber", commences_on: "2027-04-15", deadline_on: "2027-07-14" },
    { region: "north_west", commences_on: "2027-05-15", deadline_on: "2027-08-14" },
    { region: "north_east", commences_on: "2027-06-15", deadline_on: "2027-09-14" },
    { region: "london", commences_on: "2027-07-15", deadline_on: "2027-10-14" },
    { region: "south_west", commences_on: "2027-08-15", deadline_on: "2027-11-14" },
  ],
};

export const CURRENT_TIMETABLE = REGION_TIMETABLE_V1;

export function timetableFor(
  region: Itl1Region,
  timetable: RegionTimetable = CURRENT_TIMETABLE,
): RegionTimetableEntry {
  const entry = timetable.entries.find((e) => e.region === region);
  if (!entry) {
    throw new Error(`No timetable entry for region: ${region}`);
  }
  return entry;
}
