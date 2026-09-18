"use server";

import { z } from "zod";
import { answerPulse } from "../../../lib/pulse";

export type CheckInResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  token: z.string().min(20),
  households: z.coerce.number().int().min(0).max(50),
  occupants: z.coerce.number().int().min(0).max(200),
});

/**
 * Submit a tenant check-in.
 *
 * Public and unauthenticated, so everything is validated here and again inside
 * the database function. Nothing about the submitter is recorded.
 */
export async function submitCheckIn(_prev: CheckInResult | null, formData: FormData): Promise<CheckInResult> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    households: formData.get("households"),
    occupants: formData.get("occupants"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Please check those numbers." };
  }

  return answerPulse(parsed.data.token, parsed.data.households, parsed.data.occupants);
}
