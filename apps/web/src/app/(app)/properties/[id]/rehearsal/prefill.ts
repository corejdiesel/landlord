import type { PoolClient } from "pg";
import type { RehearsalAnswers } from "@letsorted/rules";

/**
 * Prefill the Rehearsal from what we already know.
 *
 * The product promise is that the government form becomes a two-minute
 * copy-and-confirm job. That only holds if the landlord does not have to
 * re-enter everything here first, so anything we hold is filled in and the
 * landlord only confirms it.
 */
export async function prefillAnswers(
  client: PoolClient,
  propertyId: string,
): Promise<{ answers: RehearsalAnswers; entityType: "individual" | "company" | "trust" | "representative" }> {
  const { rows: propertyRows } = await client.query<{
    line1: string; town: string | null; postcode: string;
    type: string; ownership: string; bedrooms: number; furnished: string;
    has_gas: boolean; licence_kind: string; licence_number: string | null;
    freeholder_name: string | null; freeholder_email: string | null;
    superior_landlord_name: string | null;
    property_manager_name: string | null; property_manager_email: string | null;
  }>(
    `select line1, town, postcode, type::text as type, ownership::text as ownership,
            bedrooms, furnished, has_gas, licence_kind::text as licence_kind, licence_number,
            freeholder_name, freeholder_email, superior_landlord_name,
            property_manager_name, property_manager_email
       from live_properties where id = $1`,
    [propertyId],
  );
  const p = propertyRows[0];
  if (!p) return { answers: {}, entityType: "individual" };

  const { rows: tenancyRows } = await client.query<{
    rent_pennies: string; rent_frequency: string; bills_included: boolean;
    households: number; occupants: number;
  }>(
    `select rent_pennies::text as rent_pennies, rent_frequency::text as rent_frequency,
            bills_included, households, occupants
       from live_tenancies
      where property_id = $1 and ended_on is null and parent_tenancy_id is null
      order by started_on desc limit 1`,
    [propertyId],
  );
  const t = tenancyRows[0];

  const { rows: entityRows } = await client.query<{
    entity_type: "individual" | "company" | "trust" | "representative";
    name: string; email: string | null;
    correspondence_line1: string | null; correspondence_town: string | null;
    correspondence_postcode: string | null; companies_house_number: string | null;
  }>(
    `select e.entity_type, e.name, e.email, e.correspondence_line1, e.correspondence_town,
            e.correspondence_postcode, e.companies_house_number
       from live_landlord_entities e
       join live_property_landlords pl on pl.landlord_entity_id = e.id
      where pl.property_id = $1
      order by pl.is_lead desc limit 1`,
    [propertyId],
  );
  const e = entityRows[0];

  const { rows: docRows } = await client.query<{ kind: string }>(
    `select kind::text as kind from live_documents
      where property_id = $1 and confirmed_at is not null
        and (expires_on is null or expires_on >= current_date)`,
    [propertyId],
  );
  const kinds = new Set(docRows.map((d) => d.kind));

  // The house or flat number is the leading number of the first address line.
  const houseNumber = /^([0-9]+[A-Za-z]?|Flat\s+\S+)/i.exec(p.line1)?.[1] ?? p.line1;

  const answers: RehearsalAnswers = {
    postcode: p.postcode,
    house_number: houseNumber,
    property_type: p.type,
    ownership: p.ownership,
    bedrooms: p.bedrooms,
    furnished: p.furnished,
    has_gas: p.has_gas ? "yes" : "no",
    licence_kind: p.licence_kind,
    licence_number: p.licence_number,
    freeholder_name: p.freeholder_name,
    freeholder_email: p.freeholder_email,
    superior_landlord_name: p.superior_landlord_name,
    property_manager_name: p.property_manager_name,
    property_manager_email: p.property_manager_email,
    is_occupied: t ? "yes" : "no",
    // A certificate we hold, in date and confirmed, answers the upload question.
    gas_certificate: kinds.has("gas_safety_record") ? "On file" : null,
    electrical_certificate_type: kinds.has("eicr") ? "eicr" : kinds.has("eic") ? "eic" : null,
    epc_confirm: kinds.has("epc") ? "yes" : null,
  };

  if (t) {
    answers["households"] = t.households;
    answers["occupants"] = t.occupants;
    answers["bills_included"] = t.bills_included ? "yes" : "no";
    answers["rent_frequency"] = t.rent_frequency;
    answers["rent_amount"] = (Number(t.rent_pennies) / 100).toFixed(2);
  }

  if (e) {
    answers["landlord_name"] = e.name;
    answers["landlord_email"] = e.email;
    answers["correspondence_line1"] = e.correspondence_line1;
    answers["correspondence_town"] = e.correspondence_town;
    answers["correspondence_postcode"] = e.correspondence_postcode;
    if (e.entity_type === "company") {
      answers["companies_house_number"] = e.companies_house_number;
      answers["company_name"] = e.name;
    }
  }

  return { answers, entityType: e?.entity_type ?? "individual" };
}
