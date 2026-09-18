"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../../../../../lib/auth";
import { withAccount } from "../../../../../lib/db";
import { createPulseRequest, sendPulseInvite } from "../../../../../lib/pulse";
import { createPassport, revokePassport, type PassportField } from "../../../../../lib/passport";
import { env } from "../../../../../lib/env";

export type ShareResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const pulseSchema = z.object({
  property_id: z.string().uuid(),
  // Optional on purpose: a landlord may print a slip or record the answer by hand.
  tenant_email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
});

export async function createCheckIn(_prev: ShareResult | null, formData: FormData): Promise<ShareResult<{ link: string }>> {
  const session = await requireSession();
  const parsed = pulseSchema.safeParse({
    property_id: formData.get("property_id"),
    tenant_email: formData.get("tenant_email") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: "That email address does not look right." };
  }

  const { token } = await createPulseRequest(session, parsed.data.property_id);
  const link = `${env().APP_URL}/check-in/${token}`;

  if (parsed.data.tenant_email) {
    const label = await withAccount(session, async (client) => {
      const { rows } = await client.query<{ line1: string; postcode: string }>(
        "select line1, postcode from live_properties where id = $1", [parsed.data.property_id],
      );
      const p = rows[0];
      return p ? `${p.line1}, ${p.postcode}` : "your home";
    });
    await sendPulseInvite(session, label, parsed.data.tenant_email, token, env().APP_URL);
  }

  revalidatePath(`/properties/${parsed.data.property_id}/sharing`);
  return { ok: true, data: { link } };
}

const passportSchema = z.object({
  property_id: z.string().uuid(),
});

export async function createPropertyPassport(_prev: ShareResult | null, formData: FormData): Promise<ShareResult<{ link: string }>> {
  const session = await requireSession();
  const parsed = passportSchema.safeParse({ property_id: formData.get("property_id") });
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };

  // Only fields explicitly ticked are shown. The default is the conservative set.
  const visibility: Partial<Record<PassportField, boolean>> = {};
  for (const field of ["registered", "registration_number", "gas_in_date",
                       "electrical_in_date", "epc_rating", "licence_held", "deposit_scheme"] as PassportField[]) {
    visibility[field] = formData.get(`show_${field}`) === "on";
  }

  const { slug } = await createPassport(session, parsed.data.property_id, visibility);
  revalidatePath(`/properties/${parsed.data.property_id}/sharing`);
  return { ok: true, data: { link: `${env().APP_URL}/p/${slug}` } };
}

export async function revokePropertyPassport(_prev: ShareResult | null, formData: FormData): Promise<ShareResult> {
  const session = await requireSession();
  const slug = String(formData.get("slug") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!slug) return { ok: false, error: "Nothing to withdraw." };

  await revokePassport(session, slug);
  revalidatePath(`/properties/${propertyId}/sharing`);
  return { ok: true };
}
