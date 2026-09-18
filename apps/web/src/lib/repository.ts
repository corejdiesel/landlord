import type { PoolClient } from "pg";
import {
  ALL_RULES, evaluate, exposurePennies, nextBestAction,
  type ComplianceDocument, type EvaluationInput, type Itl1Region,
  type LandlordFacts, type Obligation, type PropertyFacts,
  type RegistrationFacts, type TenancyFacts,
} from "@letsorted/rules";
import { withAccount, type AccountContext } from "./db";

/**
 * Repository layer.
 *
 * The one place that turns database rows into the pure rule engine's facts and
 * back. Everything reads through the `live_*` views, so soft-deleted rows are
 * invisible without every call site remembering to filter (see DECISIONS D3).
 */

export type PropertyRow = {
  id: string;
  line1: string;
  line2: string | null;
  town: string | null;
  postcode: string;
  itl1_region: Itl1Region;
  type: PropertyFacts["type"];
  ownership: PropertyFacts["ownership"];
  bedrooms: number;
  storeys: number;
  furnished: string;
  has_gas: boolean;
  has_fixed_combustion_appliance: boolean;
  hmo: boolean;
  licence_kind: PropertyFacts["licence_kind"];
  licence_number: string | null;
  licence_expires_on: string | null;
  is_let: boolean;
  freeholder_name: string | null;
  freeholder_email: string | null;
  superior_landlord_name: string | null;
  superior_landlord_email: string | null;
  property_manager_name: string | null;
  property_manager_email: string | null;
};

export function propertyLabel(p: Pick<PropertyRow, "line1" | "town" | "postcode">): string {
  return [p.line1, p.town, p.postcode].filter(Boolean).join(", ");
}

export async function listProperties(ctx: AccountContext): Promise<PropertyRow[]> {
  return withAccount(ctx, async (client) => {
    const { rows } = await client.query<PropertyRow>(
      `select id, line1, line2, town, postcode, itl1_region, type, ownership,
              bedrooms, storeys, furnished, has_gas, has_fixed_combustion_appliance,
              hmo, licence_kind, licence_number,
              to_char(licence_expires_on, 'YYYY-MM-DD') as licence_expires_on,
              is_let, freeholder_name, freeholder_email, superior_landlord_name,
              superior_landlord_email, property_manager_name, property_manager_email
         from live_properties
        order by created_at asc`,
    );
    return rows;
  });
}

export async function getProperty(ctx: AccountContext, id: string): Promise<PropertyRow | null> {
  const all = await listProperties(ctx);
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Load everything the rule engine needs for one property.
 *
 * Dates come back as `YYYY-MM-DD` strings rather than JS Dates: the engine works
 * in calendar dates and converting through `Date` is how timezone bugs get in
 * (see DECISIONS D7).
 */
export async function evaluationInputFor(
  client: PoolClient,
  propertyId: string,
  today: string,
): Promise<EvaluationInput | null> {
  const property = await client.query<PropertyFacts & { account_id: string }>(
    `select id, postcode, itl1_region, type, ownership, bedrooms, storeys,
            has_gas, has_fixed_combustion_appliance, hmo, licence_kind,
            to_char(licence_expires_on, 'YYYY-MM-DD') as licence_expires_on,
            is_let, account_id
       from live_properties where id = $1`,
    [propertyId],
  );
  const prop = property.rows[0];
  if (!prop) return null;

  const tenancy = await client.query<TenancyFacts>(
    `select id, property_id, kind,
            to_char(started_on, 'YYYY-MM-DD') as started_on,
            to_char(ended_on, 'YYYY-MM-DD') as ended_on,
            rent_pennies, rent_frequency, bills_included, households, occupants,
            deposit_taken, deposit_pennies,
            to_char(deposit_protected_on, 'YYYY-MM-DD') as deposit_protected_on,
            to_char(prescribed_information_served_on, 'YYYY-MM-DD') as prescribed_information_served_on,
            to_char(right_to_rent_checked_on, 'YYYY-MM-DD') as right_to_rent_checked_on,
            to_char(right_to_rent_follow_up_on, 'YYYY-MM-DD') as right_to_rent_follow_up_on,
            to_char(alarms_tested_on, 'YYYY-MM-DD') as alarms_tested_on
       from live_tenancies
      where property_id = $1 and ended_on is null and parent_tenancy_id is null
      order by started_on desc limit 1`,
    [propertyId],
  );

  const documents = await client.query<ComplianceDocument>(
    `select id, property_id, kind,
            to_char(issued_on, 'YYYY-MM-DD') as issued_on,
            to_char(expires_on, 'YYYY-MM-DD') as expires_on,
            outcome, epc_rating,
            to_char(served_on_tenant_at, 'YYYY-MM-DD') as served_on_tenant_at,
            confirmed_at
       from live_documents where property_id = $1`,
    [propertyId],
  );

  const registration = await client.query<RegistrationFacts>(
    `select property_id, property_registration_number,
            to_char(registered_on, 'YYYY-MM-DD') as registered_on,
            to_char(renewal_due_on, 'YYYY-MM-DD') as renewal_due_on,
            status
       from live_registrations where property_id = $1`,
    [propertyId],
  );

  const landlord = await client.query<LandlordFacts>(
    `select e.id, e.entity_type, e.landlord_registration_number,
            to_char(e.registered_on, 'YYYY-MM-DD') as registered_on
       from live_landlord_entities e
       join live_property_landlords pl on pl.landlord_entity_id = e.id
      where pl.property_id = $1
      order by pl.is_lead desc, e.created_at asc
      limit 1`,
    [propertyId],
  );

  // rent_pennies and deposit_pennies arrive as strings from pg (bigint), so
  // convert rather than letting a string reach code that expects a bigint.
  const t = tenancy.rows[0];
  const tenancyFacts: TenancyFacts | null = t
    ? { ...t, rent_pennies: BigInt(t.rent_pennies), deposit_pennies: BigInt(t.deposit_pennies) }
    : null;

  return {
    landlord: landlord.rows[0] ?? {
      id: "none",
      entity_type: "individual",
      landlord_registration_number: null,
      registered_on: null,
    },
    property: prop,
    tenancy: tenancyFacts,
    documents: documents.rows,
    registration: registration.rows[0] ?? {
      property_id: propertyId,
      property_registration_number: null,
      registered_on: null,
      renewal_due_on: null,
      status: "none",
    },
    today,
  };
}

export type PropertyObligations = {
  property: PropertyRow;
  obligations: Obligation[];
  exposure_pennies: bigint;
  next_action: Obligation | null;
};

/** Evaluate every property in the account. */
export async function evaluateAccount(
  ctx: AccountContext,
  today: string,
  options: { includeUnverified?: boolean } = {},
): Promise<PropertyObligations[]> {
  const properties = await listProperties(ctx);

  return withAccount(ctx, async (client) => {
    const out: PropertyObligations[] = [];
    for (const property of properties) {
      const input = await evaluationInputFor(client, property.id, today);
      if (!input) continue;
      const obligations = evaluate(input, ALL_RULES, options);
      out.push({
        property,
        obligations,
        exposure_pennies: exposurePennies(obligations),
        next_action: nextBestAction(obligations),
      });
    }
    return out;
  });
}

/**
 * Persist the engine's output.
 *
 * Materialised so reminders and the dashboard read a table rather than
 * re-running the engine, and so a state transition (upcoming → overdue) is
 * observable and can be ledgered.
 */
export async function materialiseObligations(
  client: PoolClient,
  accountId: string,
  propertyId: string,
  obligations: Obligation[],
  today: string,
): Promise<void> {
  for (const o of obligations) {
    await client.query(
      `insert into obligations
         (account_id, property_id, rule_id, rule_version, title, reason, due_on, state, satisfied_by, evaluated_on)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8::obligation_state, $9, $10::date)
       on conflict (property_id, rule_id) do update
         set rule_version = excluded.rule_version,
             title = excluded.title,
             reason = excluded.reason,
             due_on = excluded.due_on,
             state = excluded.state,
             satisfied_by = excluded.satisfied_by,
             evaluated_on = excluded.evaluated_on,
             updated_at = now()`,
      [accountId, propertyId, o.rule_id, o.rule_version, o.title, o.reason,
       o.due_on, o.state, o.satisfied_by, today],
    );
  }
}
