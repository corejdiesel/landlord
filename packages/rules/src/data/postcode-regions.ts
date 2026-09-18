import type { Itl1Region } from "../types.js";

/**
 * Bundled postcode-area -> ITL1 region fallback.
 *
 * The live path is postcodes.io (open, no key). This table is the offline /
 * mocked fallback so the Deadline Radar works with zero keys and zero network.
 *
 * ACCURACY NOTE: this maps by postcode AREA (the letters), which is coarse.
 * Several areas straddle a regional boundary, and a few straddle the England
 * border. Where an area is genuinely split we map it to the region containing
 * most of its delivery points and flag it as `approximate`, so the UI can tell
 * the user to confirm. Never present a fallback answer as authoritative.
 */

export type PostcodeAreaMapping = {
  region: Itl1Region;
  /** True when the area straddles a regional boundary. */
  approximate?: boolean;
  /** Set when the area is wholly or partly outside England. */
  outside_england?: "wales" | "scotland" | "mixed";
};

export const POSTCODE_AREA_REGIONS: Record<string, PostcodeAreaMapping> = {
  // London
  E: { region: "london" }, EC: { region: "london" }, N: { region: "london" },
  NW: { region: "london" }, SE: { region: "london" }, SW: { region: "london" },
  W: { region: "london" }, WC: { region: "london" },
  // South East
  BN: { region: "south_east" }, CT: { region: "south_east" }, GU: { region: "south_east", approximate: true },
  HP: { region: "south_east", approximate: true }, ME: { region: "south_east" }, MK: { region: "south_east", approximate: true },
  OX: { region: "south_east" }, PO: { region: "south_east", approximate: true }, RG: { region: "south_east" },
  RH: { region: "south_east" }, SL: { region: "south_east" }, SO: { region: "south_east" },
  TN: { region: "south_east" }, KT: { region: "south_east", approximate: true },
  // South West
  BA: { region: "south_west" }, BH: { region: "south_west", approximate: true }, BS: { region: "south_west" },
  DT: { region: "south_west" }, EX: { region: "south_west" }, GL: { region: "south_west", approximate: true },
  PL: { region: "south_west" }, SN: { region: "south_west" }, SP: { region: "south_west", approximate: true },
  TA: { region: "south_west" }, TQ: { region: "south_west" }, TR: { region: "south_west" },
  // East of England
  AL: { region: "east_of_england" }, CB: { region: "east_of_england" }, CM: { region: "east_of_england" },
  CO: { region: "east_of_england" }, EN: { region: "east_of_england", approximate: true }, IP: { region: "east_of_england" },
  LU: { region: "east_of_england" }, NR: { region: "east_of_england" }, PE: { region: "east_of_england", approximate: true },
  SG: { region: "east_of_england" }, SS: { region: "east_of_england" }, WD: { region: "east_of_england" },
  IG: { region: "london", approximate: true }, RM: { region: "london", approximate: true },
  // West Midlands
  B: { region: "west_midlands" }, CV: { region: "west_midlands", approximate: true }, DY: { region: "west_midlands" },
  HR: { region: "west_midlands", approximate: true }, ST: { region: "west_midlands" }, SY: { region: "west_midlands", outside_england: "mixed" },
  TF: { region: "west_midlands" }, WS: { region: "west_midlands" }, WV: { region: "west_midlands" },
  WR: { region: "west_midlands" },
  // East Midlands
  DE: { region: "east_midlands" }, LE: { region: "east_midlands" }, LN: { region: "east_midlands" },
  NG: { region: "east_midlands" }, NN: { region: "east_midlands" },
  // Yorkshire and the Humber
  BD: { region: "yorkshire_and_the_humber" }, DN: { region: "yorkshire_and_the_humber" },
  HD: { region: "yorkshire_and_the_humber" }, HG: { region: "yorkshire_and_the_humber" },
  HU: { region: "yorkshire_and_the_humber" }, HX: { region: "yorkshire_and_the_humber" },
  LS: { region: "yorkshire_and_the_humber" }, S: { region: "yorkshire_and_the_humber", approximate: true },
  WF: { region: "yorkshire_and_the_humber" }, YO: { region: "yorkshire_and_the_humber" },
  // North West
  BB: { region: "north_west" }, BL: { region: "north_west" }, CA: { region: "north_west", approximate: true },
  CH: { region: "north_west", outside_england: "mixed" }, CW: { region: "north_west" }, FY: { region: "north_west" },
  L: { region: "north_west" }, LA: { region: "north_west", approximate: true }, M: { region: "north_west" },
  OL: { region: "north_west" }, PR: { region: "north_west" }, SK: { region: "north_west", approximate: true },
  WA: { region: "north_west" }, WN: { region: "north_west" },
  // North East
  DH: { region: "north_east" }, DL: { region: "north_east", approximate: true }, NE: { region: "north_east" },
  SR: { region: "north_east" }, TS: { region: "north_east" },
  // Wales — in scope for the postcode parser, out of scope for the register
  CF: { region: "west_midlands", outside_england: "wales" },
  LD: { region: "west_midlands", outside_england: "wales" },
  LL: { region: "north_west", outside_england: "wales" },
  NP: { region: "south_west", outside_england: "wales" },
  SA: { region: "south_west", outside_england: "wales" },
};

/** UK postcode outward code: area letters, then district digits (+ optional letter). */
const OUTWARD = /^([A-Z]{1,2})(\d[A-Z\d]?)$/;

export type ParsedPostcode = {
  /** Normalised to uppercase with a single space, e.g. "SW1A 1AA". */
  normalised: string;
  outward: string;
  area: string;
};

/**
 * Parse and normalise a UK postcode. Accepts input with any spacing and case.
 * Returns null rather than throwing: this is user input from a public page.
 */
export function parsePostcode(raw: string): ParsedPostcode | null {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 5 || cleaned.length > 7) return null;
  const inward = cleaned.slice(-3);
  const outward = cleaned.slice(0, -3);
  if (!/^\d[A-Z]{2}$/.test(inward)) return null;
  const m = OUTWARD.exec(outward);
  if (!m) return null;
  return { normalised: `${outward} ${inward}`, outward, area: m[1]! };
}

export type RegionLookupResult = {
  region: Itl1Region;
  /** Where the answer came from, so the UI can be honest about confidence. */
  source: "postcodes_io" | "bundled_fallback";
  approximate: boolean;
  outside_england?: "wales" | "scotland" | "mixed";
};

/** Look up a region from the bundled table. Returns null if the area is unknown. */
export function regionFromPostcodeFallback(raw: string): RegionLookupResult | null {
  const parsed = parsePostcode(raw);
  if (!parsed) return null;
  const mapping = POSTCODE_AREA_REGIONS[parsed.area];
  if (!mapping) return null;
  return {
    region: mapping.region,
    source: "bundled_fallback",
    approximate: mapping.approximate ?? true,
    ...(mapping.outside_england ? { outside_england: mapping.outside_england } : {}),
  };
}
