"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../../../../lib/auth";
import { reviewChange, runLawWatch } from "../../../../lib/law-watch";

export type ReviewResult = { ok: true; message?: string } | { ok: false; error: string };

const schema = z.object({
  change_id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  summary: z.string().max(4000).optional().or(z.literal("").transform(() => undefined)),
});

export async function submitReview(_prev: ReviewResult | null, formData: FormData): Promise<ReviewResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Not authorised." };

  const parsed = schema.safeParse({
    change_id: formData.get("change_id"),
    decision: formData.get("decision"),
    summary: formData.get("summary") ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Check those details." };

  const result = await reviewChange(
    session.userId, parsed.data.change_id, parsed.data.decision, parsed.data.summary ?? null,
  );
  if (!result.ok) return result;

  revalidatePath("/admin/law-watch");
  revalidatePath("/changes");
  return { ok: true };
}

export async function triggerRun(): Promise<ReviewResult> {
  const session = await requireSession();
  if (!session.isAdmin) return { ok: false, error: "Not authorised." };

  const run = await runLawWatch();
  revalidatePath("/admin/law-watch");
  return {
    ok: true,
    message: `Checked ${run.checked} source${run.checked === 1 ? "" : "s"}, ` +
      `${run.changed} changed${run.failed.length ? `, ${run.failed.length} could not be fetched` : ""}.`,
  };
}
