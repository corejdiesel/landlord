"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parsePostcode, synchronisedRenewalDate } from "@letsorted/rules";
import { adapters } from "../../../adapters/index";
import { requireSession } from "../../../lib/auth";
import { appendLedger, withAccount } from "../../../lib/db";
import { confirmUpdated, reconcileDrift, recordRegistration } from "../../../lib/drift-service";
import { today } from "../../../lib/env";

/** Property, tenancy and registration actions. */

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const propertySchema = z.object({
  line1: z.string().min(1, "Enter the first line of the address."),
  town: z.string().optional(),
  postcode: z.string().min(5, "Enter the postcode."),
  type: z.enum(["detached", "semi_detached", "terraced", "flat", "other"]),
  ownership: z.enum(["freehold", "leasehold", "share_of_freehold", "commonhold"]),
  bedrooms: z.coerce.number().int().min(0).max(50),
  storeys: z.coerce.number().int().min(1).max(20),
  furnished: z.enum(["furnished", "part_furnished", "unfurnished"]),
  has_gas: z.coerce.boolean(),
  hmo: z.coerce.boolean(),
  licence_kind: z.enum(["selective", "hmo_mandatory", "hmo_additional", "none_needed"]),
});

export async function createProperty(_prev: ActionResult | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();

  const parsed = propertySchema.safeParse({
    line1: formData.get("line1"),
    town: formData.get("town") ?? undefined,
    postcode: formData.get("postcode"),
    type: formData.get("type"),
    ownership: formData.get("ownership"),
    bedrooms: formData.get("bedrooms"),
    storeys: formData.get("storeys"),
    furnished: formData.get("furnished"),
    has_gas: formData.get("has_gas") === "on" || formData.get("has_gas") === "true",
    hmo: formData.get("hmo") === "on" || formData.get("hmo") === "true",
    licence_kind: formData.get("licence_kind"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  const normalised = parsePostcode(parsed.data.postcode);
  if (!normalised) return { ok: false, error: "That does not look like a UK postcode." };

  // Resolve the region rather than asking the landlord: which ITL1 region a
  // property sits in is not something anyone knows off the top of their head,
  // and it is the single fact every date in the product depends on.
  const lookup = await adapters().postcodes.lookup(normalised.normalised);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const id = await withAccount(session, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into properties
         (account_id, line1, town, postcode, itl1_region, type, ownership, bedrooms,
          storeys, furnished, has_gas, has_fixed_combustion_appliance, hmo, licence_kind)
       values ($1, $2, $3, $4, $5::itl1_region, $6::property_type, $7::ownership_type,
               $8, $9, $10, $11, $11, $12, $13::licence_kind)
       returning id`,
      [
        session.accountId, parsed.data.line1, parsed.data.town ?? null,
        lookup.data.postcode, lookup.data.region, parsed.data.type, parsed.data.ownership,
        parsed.data.bedrooms, parsed.data.storeys, parsed.data.furnished,
        parsed.data.has_gas, parsed.data.hmo, parsed.data.licence_kind,
      ],
    );
    const propertyId = rows[0]!.id;

    // Link the account's landlord entity, creating one if this is their first
    // property. Joint owners are added afterwards on the property page.
    const entity = await client.query<{ id: string }>(
      "select id from live_landlord_entities order by created_at asc limit 1",
    );
    let entityId = entity.rows[0]?.id;
    if (!entityId) {
      const account = await client.query<{ name: string }>(
        "select name from live_accounts where id = $1", [session.accountId],
      );
      const created = await client.query<{ id: string }>(
        "insert into landlord_entities (account_id, name) values ($1, $2) returning id",
        [session.accountId, account.rows[0]?.name ?? "Landlord"],
      );
      entityId = created.rows[0]!.id;
    }
    await client.query(
      `insert into property_landlords (property_id, landlord_entity_id, account_id, is_lead)
       values ($1, $2, $3, true) on conflict do nothing`,
      [propertyId, entityId, session.accountId],
    );

    await appendLedger(client, session.accountId, "property.added", {
      property_id: propertyId,
      postcode: lookup.data.postcode,
      region: lookup.data.region,
    });

    return propertyId;
  });

  revalidatePath("/properties");
  revalidatePath("/dashboard");
  return { ok: true, data: { id } };
}

const tenancySchema = z.object({
  property_id: z.string().uuid(),
  kind: z.enum(["assured", "rent_act_regulated", "lodger", "high_rent", "low_rent", "supported_exempt", "other"]),
  started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date."),
  rent_pounds: z.coerce.number().min(0).max(1_000_000),
  rent_frequency: z.enum(["monthly", "four_weekly", "weekly", "other"]),
  bills_included: z.coerce.boolean(),
  households: z.coerce.number().int().min(0).max(50),
  occupants: z.coerce.number().int().min(0).max(200),
});

export async function saveTenancy(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = tenancySchema.safeParse({
    property_id: formData.get("property_id"),
    kind: formData.get("kind"),
    started_on: formData.get("started_on"),
    rent_pounds: formData.get("rent_pounds"),
    rent_frequency: formData.get("rent_frequency"),
    bills_included: formData.get("bills_included") === "on",
    households: formData.get("households"),
    occupants: formData.get("occupants"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  // Money enters as pounds from a form and is stored as pennies. Round rather
  // than truncate, and go via a string to avoid a float landing on 124999.
  const pennies = BigInt(Math.round(parsed.data.rent_pounds * 100));

  await withAccount(session, async (client) => {
    const existing = await client.query<{ id: string }>(
      `select id from live_tenancies
        where property_id = $1 and ended_on is null and parent_tenancy_id is null
        order by started_on desc limit 1`,
      [parsed.data.property_id],
    );

    if (existing.rows[0]) {
      await client.query(
        `update tenancies
            set kind = $2::tenancy_kind, started_on = $3::date, rent_pennies = $4,
                rent_frequency = $5::rent_frequency, bills_included = $6,
                households = $7, occupants = $8, updated_at = now()
          where id = $1`,
        [existing.rows[0].id, parsed.data.kind, parsed.data.started_on, pennies.toString(),
         parsed.data.rent_frequency, parsed.data.bills_included, parsed.data.households, parsed.data.occupants],
      );
    } else {
      await client.query(
        `insert into tenancies
           (account_id, property_id, kind, started_on, rent_pennies, rent_frequency,
            bills_included, households, occupants)
         values ($1, $2, $3::tenancy_kind, $4::date, $5, $6::rent_frequency, $7, $8, $9)`,
        [session.accountId, parsed.data.property_id, parsed.data.kind, parsed.data.started_on,
         pennies.toString(), parsed.data.rent_frequency, parsed.data.bills_included,
         parsed.data.households, parsed.data.occupants],
      );
    }

    await appendLedger(client, session.accountId, "tenancy.saved", {
      property_id: parsed.data.property_id,
      rent_pennies: pennies.toString(),
      households: parsed.data.households,
      occupants: parsed.data.occupants,
    });
  });

  // Any change to a registered fact may start a 28-day clock.
  await reconcileDrift(session, parsed.data.property_id, today());

  revalidatePath(`/properties/${parsed.data.property_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

const registrationSchema = z.object({
  property_id: z.string().uuid(),
  property_registration_number: z.string().min(3, "Enter the property registration number."),
  registered_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date you registered."),
  landlord_registration_number: z.string().optional(),
});

/**
 * Record a completed GOV.UK registration.
 *
 * We never submit anything: the landlord registers themselves and comes back
 * with their numbers. This date seeds the renewal engine and the drift snapshot.
 */
export async function recordRegistrationAction(
  _prev: ActionResult | null, formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = registrationSchema.safeParse({
    property_id: formData.get("property_id"),
    property_registration_number: formData.get("property_registration_number"),
    registered_on: formData.get("registered_on"),
    landlord_registration_number: formData.get("landlord_registration_number") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };
  }

  // Renewal synchronises to the anniversary of the landlord's FIRST dwelling
  // entry, not this property's own date.
  const firstEntry = await withAccount(session, async (client) => {
    const { rows } = await client.query<{ first: string | null }>(
      "select to_char(min(registered_on), 'YYYY-MM-DD') as first from live_registrations",
    );
    return rows[0]?.first ?? null;
  });
  const anchor = firstEntry && firstEntry < parsed.data.registered_on ? firstEntry : parsed.data.registered_on;
  const renewalDueOn = synchronisedRenewalDate(anchor, today());

  if (parsed.data.landlord_registration_number) {
    await withAccount(session, async (client) => {
      await client.query(
        `update landlord_entities
            set landlord_registration_number = $2, registered_on = $3::date, updated_at = now()
          where id = (select landlord_entity_id from live_property_landlords
                       where property_id = $1 order by is_lead desc limit 1)`,
        [parsed.data.property_id, parsed.data.landlord_registration_number, parsed.data.registered_on],
      );
    });
  }

  await recordRegistration(session, parsed.data.property_id, {
    propertyRegistrationNumber: parsed.data.property_registration_number,
    registeredOn: parsed.data.registered_on,
    renewalDueOn,
  });

  revalidatePath(`/properties/${parsed.data.property_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function confirmDriftUpdated(
  _prev: ActionResult | null, formData: FormData,
): Promise<ActionResult> {
  const session = await requireSession();
  const ids = formData.getAll("drift_item_id").map(String).filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Tick at least one thing you have updated." };

  const parsed = z.array(z.string().uuid()).safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Something went wrong. Please try again." };

  const { closed } = await confirmUpdated(session, parsed.data, null);
  if (closed === 0) return { ok: false, error: "Those were already marked as updated." };

  revalidatePath("/dashboard");
  return { ok: true };
}
