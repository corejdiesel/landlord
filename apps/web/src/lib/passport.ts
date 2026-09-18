import { appendLedger, withAccount, withoutAccount, type AccountContext } from "./db";
import { newPassportSlug } from "./tokens";

/**
 * Tenant Passport.
 *
 * A public, privacy-safe page per property for prospective and current tenants.
 *
 * THE THREAT MODEL IS THE FEATURE. A passport must never leak:
 *  - the landlord's home or correspondence address
 *  - a date of birth
 *  - any document, unless individually opted in
 *  - the registration number, unless the landlord chose to show it
 *
 * `PUBLIC_FIELDS` below is an allowlist, not a denylist, and `buildPassportView`
 * can only return fields in it. A future column added to `properties` therefore
 * cannot leak by accident — it has to be added here deliberately.
 */

export type PassportField =
  | "registered"
  | "registration_number"
  | "gas_in_date"
  | "electrical_in_date"
  | "epc_rating"
  | "licence_held"
  | "deposit_scheme";

export const PUBLIC_FIELDS: PassportField[] = [
  "registered", "registration_number", "gas_in_date", "electrical_in_date",
  "epc_rating", "licence_held", "deposit_scheme",
];

/** Sensible defaults: useful to a tenant, nothing identifying about the landlord. */
export const DEFAULT_VISIBILITY: Record<PassportField, boolean> = {
  registered: true,
  // Off by default. Useful, but it is the landlord's to disclose, not ours.
  registration_number: false,
  gas_in_date: true,
  electrical_in_date: true,
  epc_rating: true,
  licence_held: true,
  deposit_scheme: true,
};

export type PassportView = {
  /** Street and town only. Never the full address, never the landlord's. */
  location: string;
  fields: { key: PassportField; label: string; value: string }[];
  generated_on: string;
};

const LABELS: Record<PassportField, string> = {
  registered: "Registered with the government",
  registration_number: "Registration number",
  gas_in_date: "Gas safety check",
  electrical_in_date: "Electrical safety report",
  epc_rating: "Energy rating",
  licence_held: "Council licence",
  deposit_scheme: "Deposit protection",
};

export async function createPassport(
  ctx: AccountContext,
  propertyId: string,
  visibility: Partial<Record<PassportField, boolean>> = {},
): Promise<{ slug: string }> {
  const slug = newPassportSlug();
  const merged = { ...DEFAULT_VISIBILITY, ...visibility };

  await withAccount(ctx, async (client) => {
    await client.query(
      `insert into passports (account_id, property_id, slug, visibility)
       values ($1, $2, $3, $4::jsonb)`,
      [ctx.accountId, propertyId, slug, JSON.stringify(merged)],
    );
    await appendLedger(client, ctx.accountId, "passport.created", {
      property_id: propertyId,
      // The slug is not ledgered: the ledger is exportable, and a Defence File
      // should not carry a live public link.
      visible_fields: Object.entries(merged).filter(([, v]) => v).map(([k]) => k),
    });
  });

  return { slug };
}

export async function revokePassport(ctx: AccountContext, slug: string): Promise<void> {
  await withAccount(ctx, async (client) => {
    const { rows } = await client.query<{ property_id: string }>(
      "update passports set revoked_at = now(), updated_at = now() where slug = $1 returning property_id",
      [slug],
    );
    if (rows[0]) {
      await appendLedger(client, ctx.accountId, "passport.revoked", { property_id: rows[0].property_id });
    }
  });
}

/**
 * Resolve a passport for an anonymous visitor.
 *
 * The SECURITY DEFINER function returns the property's address parts, and this
 * function reduces them to street and town. The full address never leaves here.
 */
export async function buildPassportView(
  slug: string,
  today: string,
): Promise<PassportView | null> {
  if (!slug || slug.length < 16) return null;

  const base = await withoutAccount(async (client) => {
    const { rows } = await client.query<{
      property_id: string; line1: string; town: string | null;
      postcode: string; visibility: Record<string, boolean>;
    }>("select property_id, line1, town, postcode, visibility from public_passport($1)", [slug]);
    return rows[0] ?? null;
  });

  if (!base) return null;

  const facts = await withoutAccount(async (client) => {
    // Runs with the bootstrap flag, like the other public surfaces, and reads
    // only the compliance facts the passport is allowed to show.
    await client.query("select set_config('app.bootstrap', 'on', false)");
    try {
      const { rows } = await client.query<{
        gas_expires: string | null; elec_expires: string | null;
        epc_rating: string | null; licence_kind: string;
        licence_expires: string | null; deposit_scheme: string | null;
        registration_status: string | null; registration_number: string | null;
      }>(
        `select
           (select to_char(max(d.expires_on), 'YYYY-MM-DD') from documents d
             where d.property_id = p.id and d.kind = 'gas_safety_record'
               and d.confirmed_at is not null and d.deleted_at is null) as gas_expires,
           (select to_char(max(d.expires_on), 'YYYY-MM-DD') from documents d
             where d.property_id = p.id and d.kind in ('eicr','eic')
               and d.confirmed_at is not null and d.deleted_at is null) as elec_expires,
           (select d.epc_rating from documents d
             where d.property_id = p.id and d.kind = 'epc'
               and d.confirmed_at is not null and d.deleted_at is null
             order by d.issued_on desc limit 1) as epc_rating,
           p.licence_kind::text as licence_kind,
           to_char(p.licence_expires_on, 'YYYY-MM-DD') as licence_expires,
           (select t.deposit_scheme from tenancies t
             where t.property_id = p.id and t.ended_on is null and t.deleted_at is null
             order by t.started_on desc limit 1) as deposit_scheme,
           (select r.status::text from registrations r
             where r.property_id = p.id and r.deleted_at is null) as registration_status,
           (select r.property_registration_number from registrations r
             where r.property_id = p.id and r.deleted_at is null) as registration_number
         from properties p where p.id = $1`,
        [base.property_id],
      );
      return rows[0] ?? null;
    } finally {
      await client.query("select set_config('app.bootstrap', 'off', false)");
    }
  });

  if (!facts) return null;

  const inDate = (expires: string | null) => expires !== null && expires >= today;

  const candidate: Record<PassportField, string | null> = {
    registered: facts.registration_status === "active" ? "Yes" : "Not yet",
    registration_number: facts.registration_number,
    gas_in_date: inDate(facts.gas_expires) ? "In date" : "Not on record",
    electrical_in_date: inDate(facts.elec_expires) ? "In date" : "Not on record",
    epc_rating: facts.epc_rating,
    licence_held: facts.licence_kind === "none_needed"
      ? "Not required"
      : inDate(facts.licence_expires) ? "Held" : "Not on record",
    deposit_scheme: facts.deposit_scheme,
  };

  // The allowlist is the security boundary: only a field named in PUBLIC_FIELDS,
  // and switched on by the landlord, can appear.
  const fields = PUBLIC_FIELDS
    .filter((key) => base.visibility[key] === true)
    .map((key) => ({ key, label: LABELS[key], value: candidate[key] ?? "Not on record" }))
    .filter((f) => f.value !== "");

  return {
    // Street and town only. Never the house number, never the landlord's address.
    location: [stripBuildingNumber(base.line1), base.town].filter(Boolean).join(", "),
    fields,
    generated_on: today,
  };
}

/**
 * Reduce an address line to a street name.
 *
 * A passport identifies a property to someone who is already looking at it, so
 * the street is enough. Including the number would turn a shared link into a
 * precise address, which is exactly what tenants and landlords are wary of.
 */
export function stripBuildingNumber(line1: string): string {
  return line1
    .replace(/^(flat|apartment|unit)\s+\S+\s*,?\s*/i, "")
    .replace(/^\d+[A-Za-z]?\s*,?\s*/, "")
    .trim();
}
