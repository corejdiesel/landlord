"use server";

import { z } from "zod";
import { answerAttestation } from "../../../lib/attestation";

export type AttestationResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  token: z.string().min(20),
  decision: z.enum(["confirmed", "disputed"]),
  note: z.string().max(2000).optional().or(z.literal("").transform(() => undefined)),
});

export async function submitAttestation(
  _prev: AttestationResult | null, formData: FormData,
): Promise<AttestationResult> {
  const parsed = schema.safeParse({
    token: formData.get("token"),
    decision: formData.get("decision"),
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try the link again." };

  return answerAttestation(parsed.data.token, parsed.data.decision, parsed.data.note ?? null);
}
