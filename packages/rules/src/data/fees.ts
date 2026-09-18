import type { RuleSource } from "../types.js";

/**
 * PRS Database fee schedule, versioned. Money is always pennies as bigint.
 *
 * SOURCE STATUS: secondary — £65 per dwelling entry per year, landlord entry
 * free. Confirm against the made regulations before launch.
 */

export type FeeSchedule = {
  version: number;
  effective_from: string;
  /** Annual fee per dwelling entry, in pennies. */
  dwelling_entry_pennies: bigint;
  /** Annual fee per landlord entry, in pennies. Free at time of writing. */
  landlord_entry_pennies: bigint;
  verification_status: "verified_primary" | "verified_secondary" | "unverified";
  sources: RuleSource[];
};

export const FEE_SCHEDULE_V1: FeeSchedule = {
  version: 1,
  effective_from: "2026-12-15",
  dwelling_entry_pennies: 6500n,
  landlord_entry_pennies: 0n,
  verification_status: "verified_secondary",
  sources: [
    {
      label: "GOV.UK Housing Hub — Get ready to register",
      url: "https://housinghub.campaign.gov.uk/renting-is-changing/get-ready-to-register/",
      checked_on: "2026-09-18",
    },
  ],
};

export const CURRENT_FEES = FEE_SCHEDULE_V1;

/** Annual cost for N dwelling entries, in pennies. */
export function annualCostPennies(
  properties: number,
  fees: FeeSchedule = CURRENT_FEES,
): bigint {
  if (!Number.isInteger(properties) || properties < 0) {
    throw new Error(`properties must be a non-negative integer, got ${properties}`);
  }
  return fees.dwelling_entry_pennies * BigInt(properties);
}
