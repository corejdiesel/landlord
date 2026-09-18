import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { addDays } from "@letsorted/rules";
import { adapters, type DocumentExtraction } from "../adapters/index";
import { appendLedger, withAccount, type AccountContext } from "./db";

/**
 * Cert Inbox.
 *
 * The rule that shapes everything here: **nothing the model produces reaches
 * compliance state until a human confirms it in the UI.** An extraction is
 * stored with `confirmed_at` null, the rule engine ignores unconfirmed
 * documents entirely, and only `confirmDocument` moves anything.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp", "text/plain",
]);

/**
 * Sniff the real type from the magic bytes rather than trusting the declared
 * one. An attacker controls the Content-Type header; they do not control what
 * the first bytes of the file actually are.
 */
export function sniffMimeType(buffer: Buffer, declared: string): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("latin1") === "RIFF"
      && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("latin1") === "ftyp") return "image/heic";
  // Plain text has no magic bytes; accept it only when that is what was declared
  // and the content is actually printable.
  if (declared === "text/plain" && isProbablyText(buffer)) return "text/plain";
  return null;
}

function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 512);
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}

export type UploadResult =
  | { ok: true; documentId: string; extraction: DocumentExtraction; matchedPropertyId: string | null }
  | { ok: false; error: string };

/**
 * Accept a document, extract from it, and store it UNCONFIRMED.
 *
 * Virus scanning is a stub in this build (see `scanForViruses`), and is called
 * before anything is written, so wiring a real scanner in is one function.
 */
export async function ingestDocument(
  ctx: AccountContext,
  input: {
    filename: string;
    declaredMimeType: string;
    content: Buffer;
    propertyId?: string | null;
    via: "upload" | "inbound_email";
  },
): Promise<UploadResult> {
  if (input.content.byteLength === 0) return { ok: false, error: "That file is empty." };
  if (input.content.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is larger than 20MB. Try a smaller scan or a photo." };
  }

  const mimeType = sniffMimeType(input.content, input.declaredMimeType);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    return { ok: false, error: "We can take a PDF or a photo. That file looks like something else." };
  }

  const scan = await scanForViruses(input.content);
  if (!scan.clean) return { ok: false, error: "That file did not pass our safety check." };

  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const { storage, llm } = adapters();

  const stored = await storage.put(
    `${ctx.accountId}/${sha256.slice(0, 2)}/${sha256}`,
    input.content,
    mimeType,
  );
  if (!stored.ok) return { ok: false, error: "We could not save that file. Please try again." };

  const extracted = await llm.extractDocument({
    filename: input.filename,
    mimeType,
    content: input.content,
  });
  if (!extracted.ok) {
    return { ok: false, error: "We could not read that document. You can still add the details yourself." };
  }

  const matchedPropertyId = input.propertyId
    ?? (await matchProperty(ctx, extracted.data.property_address));

  const documentId = await withAccount(ctx, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into documents
         (account_id, property_id, kind, original_filename, storage_path, mime_type,
          byte_size, sha256, issued_on, expires_on, outcome, epc_rating, engineer_id,
          extraction, confidence)
       values ($1, $2, $3::document_kind, $4, $5, $6, $7, $8, $9::date, $10::date,
               $11::document_outcome, $12, $13, $14::jsonb, $15::jsonb)
       returning id`,
      [
        ctx.accountId, matchedPropertyId, extracted.data.kind, input.filename,
        stored.data.path, mimeType, stored.data.byteSize, sha256,
        extracted.data.issued_on, extracted.data.expires_on, extracted.data.outcome,
        extracted.data.epc_rating, extracted.data.engineer_id,
        JSON.stringify(extracted.data), JSON.stringify(extracted.data.confidence),
      ],
    );
    const id = rows[0]!.id;

    // The file hash goes in the ledger, so a Defence File can later show that
    // the document produced today is the one that was uploaded then.
    await appendLedger(client, ctx.accountId, "document.uploaded", {
      document_id: id,
      filename: input.filename,
      sha256,
      via: input.via,
      extracted_kind: extracted.data.kind,
      matched_property_id: matchedPropertyId,
    });

    return id;
  });

  return { ok: true, documentId, extraction: extracted.data, matchedPropertyId };
}

/**
 * Virus scan hook.
 *
 * A stub in this build — there is no scanner to call and the spec forbids
 * production services. It exists as a real call site so adding ClamAV or an
 * equivalent is one function body, not a refactor of the ingest path.
 */
export async function scanForViruses(content: Buffer): Promise<{ clean: boolean; scanner: string }> {
  // The EICAR test string, so the refusal path is exercisable without a scanner.
  const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
  if (content.subarray(0, 256).toString("latin1").includes(EICAR)) {
    return { clean: false, scanner: "stub" };
  }
  return { clean: true, scanner: "stub (no scanner configured)" };
}

/**
 * Fuzzy-match an extracted address to one of the account's properties.
 *
 * Returns null rather than a bad guess. Attaching a certificate to the wrong
 * property would mark one compliant and leave another exposed, so the bar for
 * an automatic match is deliberately high and the UI always shows the choice.
 */
export async function matchProperty(
  ctx: AccountContext,
  address: string | null,
): Promise<string | null> {
  if (!address) return null;

  return withAccount(ctx, async (client) => {
    const { rows } = await client.query<{ id: string; line1: string; postcode: string }>(
      "select id, line1, postcode from live_properties",
    );
    if (rows.length === 0) return null;

    const needle = normaliseAddress(address);

    // A postcode match is strong evidence on its own.
    const byPostcode = rows.filter((r) => needle.includes(normaliseAddress(r.postcode)));
    if (byPostcode.length === 1) return byPostcode[0]!.id;

    const scored = rows
      .map((r) => ({ id: r.id, score: addressScore(needle, normaliseAddress(r.line1)) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best || best.score < 0.6) return null;
    // Ambiguous between two properties is the same as no match.
    if (second && best.score - second.score < 0.2) return null;
    return best.id;
  });
}

export function normaliseAddress(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Token overlap, weighted so a matching leading number counts heavily. */
export function addressScore(a: string, b: string): number {
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;

  const bSet = new Set(bTokens);
  const overlap = aTokens.filter((t) => bSet.has(t)).length;
  const base = overlap / Math.max(aTokens.length, bTokens.length);

  const aNumber = aTokens.find((t) => /^\d+$/.test(t));
  const bNumber = bTokens.find((t) => /^\d+$/.test(t));
  if (aNumber && bNumber && aNumber !== bNumber) {
    // Different house numbers on the same street are different properties.
    return base * 0.3;
  }
  if (aNumber && bNumber && aNumber === bNumber) return Math.min(1, base + 0.25);
  return base;
}

export type ConfirmInput = {
  documentId: string;
  propertyId: string;
  kind: string;
  issuedOn: string | null;
  expiresOn: string | null;
  outcome: string;
  epcRating: string | null;
};

/**
 * The human confirms the extraction. This is the only path that changes
 * compliance state, and the only place a document becomes real.
 */
export async function confirmDocument(
  ctx: AccountContext,
  input: ConfirmInput,
): Promise<{ ok: true; remedialDueOn: string | null } | { ok: false; error: string }> {
  return withAccount(ctx, async (client) => {
    const { rows } = await client.query<{ id: string; sha256: string }>(
      `update documents
          set property_id = $2, kind = $3::document_kind, issued_on = $4::date,
              expires_on = $5::date, outcome = $6::document_outcome, epc_rating = $7,
              confirmed_by = $8, confirmed_at = now(), updated_at = now()
        where id = $1 and confirmed_at is null
        returning id, sha256`,
      [input.documentId, input.propertyId, input.kind, input.issuedOn, input.expiresOn,
       input.outcome, input.epcRating, ctx.userId],
    );
    if (rows.length === 0) {
      return { ok: false as const, error: "That document has already been confirmed." };
    }

    await appendLedger(client, ctx.accountId, "document.confirmed", {
      document_id: input.documentId,
      property_id: input.propertyId,
      kind: input.kind,
      issued_on: input.issuedOn,
      expires_on: input.expiresOn,
      outcome: input.outcome,
      sha256: rows[0]!.sha256,
      confirmed_by: ctx.userId,
    });

    // An unsatisfactory electrical report starts a 28-day remedial clock. This
    // is a legal duty in its own right, not merely a status on the document.
    let remedialDueOn: string | null = null;
    if (input.kind === "eicr" && input.outcome === "unsatisfactory" && input.issuedOn) {
      remedialDueOn = addDays(input.issuedOn, 28);
      await appendLedger(client, ctx.accountId, "remedial.opened", {
        property_id: input.propertyId,
        document_id: input.documentId,
        due_on: remedialDueOn,
      });
    }

    return { ok: true as const, remedialDueOn };
  });
}

/** Route an inbound email to an account by its unique inbox token. */
export async function accountForInboundAddress(
  toAddress: string,
): Promise<{ accountId: string; userId: string } | null> {
  const match = /\+([a-f0-9]{18})@/.exec(toAddress) ?? /^([a-f0-9]{18})@/.exec(toAddress);
  const token = match?.[1];
  if (!token) return null;

  const { withoutAccount } = await import("./db");
  return withoutAccount(async (client) => {
    // Definer-free lookup is impossible under forced RLS, so this uses the
    // same bootstrap-gated function pattern as the other pre-context reads.
    const { rows } = await client.query<{ account_id: string; user_id: string }>(
      "select account_id, user_id from app_account_for_inbound_token($1)",
      [token],
    );
    return rows[0] ? { accountId: rows[0].account_id, userId: rows[0].user_id } : null;
  });
}
