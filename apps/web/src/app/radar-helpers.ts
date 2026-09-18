import { REGION_LABELS, type Itl1Region } from "@letsorted/rules";

/**
 * Pure helpers for the Radar.
 *
 * Kept out of radar-actions.ts because a "use server" module may only export
 * async functions — and separately, these are the bits most worth unit testing.
 */

/** Postcodes a visitor may submit in one go. */
export const MAX_POSTCODES = 25;

/**
 * Split a free-text postcode list.
 *
 * Accepts commas, semicolons, newlines, and runs of whitespace, because people
 * paste from spreadsheets, emails and letting statements and should not have to
 * think about the format.
 */
export function splitPostcodes(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .flatMap((part) => part.trim().split(/\s{2,}/))
    .map((p) => p.trim())
    .filter(Boolean);
}

export function isItl1Region(value: string): value is Itl1Region {
  return Object.prototype.hasOwnProperty.call(REGION_LABELS, value);
}
