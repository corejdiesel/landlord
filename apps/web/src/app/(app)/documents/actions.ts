"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "../../../lib/auth";
import { withAccount } from "../../../lib/db";
import { confirmDocument, ingestDocument } from "../../../lib/documents-service";
import { reconcileDrift } from "../../../lib/drift-service";
import { today } from "../../../lib/env";

export type DocResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

export async function uploadDocument(_prev: DocResult | null, formData: FormData): Promise<DocResult<{ id: string }>> {
  const session = await requireSession();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  const propertyId = formData.get("property_id");
  const result = await ingestDocument(session, {
    filename: file.name,
    declaredMimeType: file.type || "application/octet-stream",
    content: Buffer.from(await file.arrayBuffer()),
    propertyId: typeof propertyId === "string" && propertyId ? propertyId : null,
    via: "upload",
  });

  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/documents");
  return { ok: true, data: { id: result.documentId } };
}

const confirmSchema = z.object({
  document_id: z.string().uuid(),
  property_id: z.string().uuid("Choose which property this belongs to."),
  kind: z.enum([
    "gas_safety_record", "eicr", "eic", "epc", "licence",
    "deposit_certificate", "tenancy_agreement", "prescribed_information",
    "right_to_rent_check", "other",
  ]),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("").transform(() => null)),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("").transform(() => null)),
  outcome: z.enum(["satisfactory", "unsatisfactory", "not_applicable", "unknown"]),
  epc_rating: z.string().regex(/^[A-G]$/).nullable().or(z.literal("").transform(() => null)),
});

/**
 * The human confirms an extraction.
 *
 * This is the only path in the product that turns a model's reading of a
 * document into compliance state, which is why it is a deliberate form
 * submission and not an "accept all" button.
 */
export async function confirmExtraction(_prev: DocResult | null, formData: FormData): Promise<DocResult> {
  const session = await requireSession();

  const parsed = confirmSchema.safeParse({
    document_id: formData.get("document_id"),
    property_id: formData.get("property_id"),
    kind: formData.get("kind"),
    issued_on: formData.get("issued_on") ?? null,
    expires_on: formData.get("expires_on") ?? null,
    outcome: formData.get("outcome") ?? "unknown",
    epc_rating: formData.get("epc_rating") ?? null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const result = await confirmDocument(session, {
    documentId: parsed.data.document_id,
    propertyId: parsed.data.property_id,
    kind: parsed.data.kind,
    issuedOn: parsed.data.issued_on,
    expiresOn: parsed.data.expires_on,
    outcome: parsed.data.outcome,
    epcRating: parsed.data.epc_rating,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // A confirmed gas certificate is a registered fact, so it may open a clock.
  await reconcileDrift(session, parsed.data.property_id, today());

  revalidatePath("/documents");
  revalidatePath(`/properties/${parsed.data.property_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Inbound email simulator.
 *
 * There is no real MX in this build, so this stands in for the webhook: it takes
 * the same shape a provider would post and runs the identical ingest path, which
 * is what makes it worth having rather than a fake.
 */
export async function simulateInboundEmail(_prev: DocResult | null, formData: FormData): Promise<DocResult> {
  const session = await requireSession();

  const subject = String(formData.get("subject") ?? "Certificate");
  const body = String(formData.get("body") ?? "");
  const filename = String(formData.get("filename") ?? "attachment.txt");

  if (!body.trim()) return { ok: false, error: "Put something in the message body to stand in for the attachment." };

  const result = await ingestDocument(session, {
    filename,
    declaredMimeType: "text/plain",
    content: Buffer.from(body, "utf8"),
    propertyId: null,
    via: "inbound_email",
  });
  if (!result.ok) return { ok: false, error: result.error };

  await withAccount(session, async (client) => {
    await client.query(
      `insert into inbound_emails (account_id, from_address, to_address, subject, attachments, routed_to)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        session.accountId, "simulated@example.test",
        `certs+simulated@${process.env.INBOUND_EMAIL_DOMAIN ?? "certs.letsorted.test"}`,
        subject, JSON.stringify([{ filename, bytes: body.length }]), result.documentId,
      ],
    );
  });

  revalidatePath("/documents");
  return { ok: true };
}
