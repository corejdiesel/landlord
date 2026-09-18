import { CURRENT_FEES, annualCostPennies, type FeeSchedule } from "./data/fees.js";
import { CURRENT_TIMETABLE, timetableFor, type RegionTimetable } from "./data/timetable.js";
import { addYears, daysBetween, formatUkLong, isAfter, isOnOrAfter } from "./dates.js";
import { REGION_LABELS, type Itl1Region } from "./types.js";

/**
 * Deadline Radar computation: the public, no-login answer to
 * "when does this apply to me, and what does it cost?".
 */

export type RadarWindowState =
  | "not_open_yet"
  | "open_now"
  | "deadline_passed";

export type RadarResult = {
  region: Itl1Region;
  region_label: string;
  commences_on: string;
  deadline_on: string;
  /** Days until registration opens. Negative once it has opened. */
  days_until_open: number;
  /** Days until the deadline. Negative once it has passed. */
  days_until_deadline: number;
  state: RadarWindowState;
  /** One plain sentence, ready to render. */
  headline: string;
};

export function radarFor(
  region: Itl1Region,
  today: string,
  timetable: RegionTimetable = CURRENT_TIMETABLE,
): RadarResult {
  const entry = timetableFor(region, timetable);
  const daysUntilOpen = daysBetween(today, entry.commences_on);
  const daysUntilDeadline = daysBetween(today, entry.deadline_on);

  const state: RadarWindowState = isAfter(entry.commences_on, today)
    ? "not_open_yet"
    : isOnOrAfter(entry.deadline_on, today)
      ? "open_now"
      : "deadline_passed";

  const headline =
    state === "not_open_yet"
      ? daysUntilOpen === 1
        ? "Registration opens for you tomorrow."
        : `Registration opens for you in ${daysUntilOpen} days.`
      : state === "open_now"
        ? daysUntilDeadline === 0
          ? "Your deadline is today."
          : `Registration is open. You have ${daysUntilDeadline} days to register.`
        : `Your deadline passed on ${formatUkLong(entry.deadline_on)}.`;

  return {
    region,
    region_label: REGION_LABELS[region],
    commences_on: entry.commences_on,
    deadline_on: entry.deadline_on,
    days_until_open: daysUntilOpen,
    days_until_deadline: daysUntilDeadline,
    state,
    headline,
  };
}

export type PortfolioRadarEntry = RadarResult & { postcodes: string[] };

export type PortfolioRadar = {
  entries: PortfolioRadarEntry[];
  /** The earliest deadline across the portfolio — the one that actually bites. */
  first_deadline_on: string | null;
  property_count: number;
  annual_cost_pennies: bigint;
};

/**
 * Build a single timeline for a portfolio spread across regions.
 *
 * Landlords with properties in several regions get several deadlines, and the
 * useful number is the earliest one, not an average.
 */
export function portfolioRadar(
  properties: { postcode: string; region: Itl1Region }[],
  today: string,
  timetable: RegionTimetable = CURRENT_TIMETABLE,
  fees: FeeSchedule = CURRENT_FEES,
): PortfolioRadar {
  const byRegion = new Map<Itl1Region, string[]>();
  for (const p of properties) {
    const existing = byRegion.get(p.region);
    if (existing) existing.push(p.postcode);
    else byRegion.set(p.region, [p.postcode]);
  }

  const entries: PortfolioRadarEntry[] = [...byRegion.entries()]
    .map(([region, postcodes]) => ({ ...radarFor(region, today, timetable), postcodes }))
    .sort((a, b) => a.deadline_on.localeCompare(b.deadline_on));

  return {
    entries,
    first_deadline_on: entries[0]?.deadline_on ?? null,
    property_count: properties.length,
    annual_cost_pennies: annualCostPennies(properties.length, fees),
  };
}

/**
 * Renewal dates synchronise to the anniversary of the landlord's FIRST dwelling
 * entry, not each property's own registration date.
 */
export function synchronisedRenewalDate(
  firstDwellingEntryOn: string,
  today: string,
): string {
  // Advance a year at a time from the original anchor so a 29 February entry
  // clamps to 28 February in common years rather than drifting into March.
  let years = 0;
  let candidate = firstDwellingEntryOn;
  while (!isOnOrAfter(candidate, today)) {
    candidate = addYears(firstDwellingEntryOn, ++years);
    if (years > 200) throw new Error("synchronisedRenewalDate failed to converge");
  }
  return candidate;
}
