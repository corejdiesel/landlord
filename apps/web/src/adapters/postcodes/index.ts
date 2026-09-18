import { regionFromPostcodeFallback, parsePostcode, type Itl1Region } from "@letsorted/rules";
import { env } from "../../lib/env";
import type { AdapterResult, PostcodeLookup, PostcodesAdapter } from "../types";

/**
 * postcodes.io is open and needs no key, so the live path is the default.
 * The bundled area table is the fallback for offline runs and for the case
 * where the service is down — a public page that is the acquisition engine
 * must not 500 because a third party is having a bad day.
 */

/** postcodes.io returns ITL/NUTS names; map them to our region enum. */
const REGION_BY_NAME: Record<string, Itl1Region> = {
  "north east (england)": "north_east",
  "north east": "north_east",
  "north west (england)": "north_west",
  "north west": "north_west",
  "yorkshire and the humber": "yorkshire_and_the_humber",
  "east midlands (england)": "east_midlands",
  "east midlands": "east_midlands",
  "west midlands (england)": "west_midlands",
  "west midlands": "west_midlands",
  "east of england": "east_of_england",
  "eastern": "east_of_england",
  "london": "london",
  "south east (england)": "south_east",
  "south east": "south_east",
  "south west (england)": "south_west",
  "south west": "south_west",
};

export function regionFromName(name: string | null | undefined): Itl1Region | null {
  if (!name) return null;
  return REGION_BY_NAME[name.trim().toLowerCase()] ?? null;
}

export class LivePostcodesAdapter implements PostcodesAdapter {
  async lookup(postcode: string): Promise<AdapterResult<PostcodeLookup>> {
    const parsed = parsePostcode(postcode);
    if (!parsed) return { ok: false, error: "That does not look like a UK postcode.", source: "live" };

    try {
      const res = await fetch(
        `${env().POSTCODES_IO_URL}/postcodes/${encodeURIComponent(parsed.normalised)}`,
        { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } },
      );
      if (!res.ok) return fallback(parsed.normalised, `postcodes.io returned ${res.status}`);

      const body = (await res.json()) as {
        result?: { region?: string; country?: string; admin_district?: string };
      };
      const region = regionFromName(body.result?.region);
      const country = body.result?.country ?? "England";

      if (!region) {
        // Wales, Scotland and Northern Ireland have no ITL1 English region.
        // The PRS Database is England-only, so say so rather than guessing.
        if (country !== "England") {
          return {
            ok: false,
            error: `That postcode is in ${country}. The database covers England only.`,
            source: "live",
          };
        }
        return fallback(parsed.normalised, "no region in the response");
      }

      return {
        ok: true,
        source: "live",
        data: {
          postcode: parsed.normalised,
          region,
          approximate: false,
          country,
          ...(body.result?.admin_district ? { admin_district: body.result.admin_district } : {}),
        },
      };
    } catch {
      return fallback(parsed.normalised, "postcodes.io unreachable");
    }
  }
}

/** Bundled table. Always answers something for a known area, flagged approximate. */
function fallback(postcode: string, _why: string): AdapterResult<PostcodeLookup> {
  const hit = regionFromPostcodeFallback(postcode);
  if (!hit) {
    return { ok: false, error: "We could not place that postcode. Please check it.", source: "mock" };
  }
  if (hit.outside_england === "wales") {
    return { ok: false, error: "That postcode is in Wales. The database covers England only.", source: "mock" };
  }
  return {
    ok: true,
    source: "mock",
    data: { postcode, region: hit.region, approximate: true, country: "England" },
  };
}

export class MockPostcodesAdapter implements PostcodesAdapter {
  async lookup(postcode: string): Promise<AdapterResult<PostcodeLookup>> {
    const parsed = parsePostcode(postcode);
    if (!parsed) return { ok: false, error: "That does not look like a UK postcode.", source: "mock" };
    return fallback(parsed.normalised, "mock adapter");
  }
}

export function postcodesAdapter(mode: "live" | "mock"): PostcodesAdapter {
  return mode === "live" ? new LivePostcodesAdapter() : new MockPostcodesAdapter();
}
