"use server";

import { z } from "zod";
import { portfolioRadar, parsePostcode, type Itl1Region, type PortfolioRadar } from "@letsorted/rules";
import { adapters } from "../adapters/index";
import { MAX_POSTCODES, isItl1Region, splitPostcodes } from "./radar-helpers";
import { withoutAccount } from "../lib/db";
import { today } from "../lib/env";

/**
 * Deadline Radar server actions.
 *
 * Public and unauthenticated, so everything is validated hard, results are
 * capped, and failures return a message rather than throwing a stack trace at
 * a prospect.
 */

const postcodesSchema = z
  .string()
  .min(1, "Enter at least one postcode.")
  .max(2000, "That is more postcodes than we can take at once.");

export type RadarLookupResult =
  | { ok: true; radar: PortfolioRadar; today: string; approximate: string[]; rejected: { postcode: string; reason: string }[] }
  | { ok: false; error: string };

export async function lookupRadar(formData: FormData): Promise<RadarLookupResult> {
  const parsed = postcodesSchema.safeParse(formData.get("postcodes"));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a postcode." };
  }

  const candidates = splitPostcodes(parsed.data).slice(0, MAX_POSTCODES);
  if (candidates.length === 0) return { ok: false, error: "Enter at least one postcode." };

  const { postcodes } = adapters();
  const resolved: { postcode: string; region: Itl1Region }[] = [];
  const approximate: string[] = [];
  const rejected: { postcode: string; reason: string }[] = [];

  // Sequential rather than parallel: this is a public endpoint hitting a free
  // third-party service, and 25 simultaneous requests per visitor is not
  // neighbourly. The list is short enough that it stays fast.
  for (const candidate of candidates) {
    const result = await postcodes.lookup(candidate);
    if (!result.ok) {
      rejected.push({ postcode: candidate, reason: result.error });
      continue;
    }
    resolved.push({ postcode: result.data.postcode, region: result.data.region });
    if (result.data.approximate) approximate.push(result.data.postcode);
  }

  if (resolved.length === 0) {
    return {
      ok: false,
      error: rejected[0]?.reason ?? "We could not place those postcodes.",
    };
  }

  return {
    ok: true,
    radar: portfolioRadar(resolved, today()),
    today: today(),
    approximate,
    rejected,
  };
}

const signupSchema = z.object({
  email: z.string().email("Enter an email address we can reach you on."),
  region: z.string().optional(),
  postcode: z.string().optional(),
  count: z.coerce.number().int().min(0).max(1000).optional(),
});

export type SignupResult = { ok: true } | { ok: false; error: string };

/**
 * "Remind me when my window opens."
 *
 * Stored with the region so the list is segmentable from day one — demand will
 * spike region by region as the rollout moves.
 */
export async function captureSignup(formData: FormData): Promise<SignupResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    region: formData.get("region") ?? undefined,
    postcode: formData.get("postcode") ?? undefined,
    count: formData.get("count") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  const region = parsed.data.region && isItl1Region(parsed.data.region) ? parsed.data.region : null;
  const postcode = parsed.data.postcode ? (parsePostcode(parsed.data.postcode)?.normalised ?? null) : null;

  try {
    await withoutAccount(async (client) => {
      await client.query("select public_capture_radar_signup($1, $2, $3::itl1_region, $4)", [
        parsed.data.email, postcode, region, parsed.data.count ?? null,
      ]);
    });
    return { ok: true };
  } catch {
    // Never surface a database error to a public visitor.
    return { ok: false, error: "We could not save that just now. Please try again." };
  }
}
