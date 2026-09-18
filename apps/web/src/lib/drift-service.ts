import type { PoolClient } from "pg";
import {
  advanceSnapshot, diffRegisteredFacts, driftStatus, openDriftItems,
  type DriftField, type DriftStatus, type RegisteredFacts,
} from "@letsorted/rules";
import { appendLedger, withAccount, type AccountContext } from "./db";

/**
 * Drift Clock persistence.
 *
 * The pure logic lives in `packages/rules`. This is only the part that has to
 * touch the database: reading the current facts, comparing them with the stored
 * snapshot of the GOV.UK entry, and recording what changed.
 *
 * Every open and close is ledgered, because a landlord's ability to show they
 * kept the entry current is the point of the feature.
 */

/**
 * Build the registered-facts view of a property from our own records.
 *
 * Only fields the register actually holds appear here — anything else cannot
 * drift, by definition.
 */
export async function currentRegisteredFacts(
  client: PoolClient,
  propertyId: string,
): Promise<RegisteredFacts | null> {
  const { rows } = await client.query<{
    bedrooms: number; furnished: string; has_gas: boolean;
    licence_kind: string; licence_number: string | null;
    property_manager_name: string | null; property_manager_email: string | null;
    freeholder_name: string | null; freeholder_email: string | null;
    superior_landlord_name: string | null;
    rent_pennies: string | null; rent_frequency: string | null;
    bills_included: boolean | null; households: number | null; occupants: number | null;
    gas_certificate_issued_on: string | null;
  }>(
    `select p.bedrooms, p.furnished, p.has_gas, p.licence_kind::text as licence_kind,
            p.licence_number, p.property_manager_name, p.property_manager_email,
            p.freeholder_name, p.freeholder_email, p.superior_landlord_name,
            t.rent_pennies::text as rent_pennies, t.rent_frequency::text as rent_frequency,
            t.bills_included, t.households, t.occupants,
            (select to_char(d.issued_on, 'YYYY-MM-DD')
               from live_documents d
              where d.property_id = p.id and d.kind = 'gas_safety_record'
                and d.confirmed_at is not null
              order by d.issued_on desc limit 1) as gas_certificate_issued_on
       from live_properties p
       left join live_tenancies t
         on t.property_id = p.id and t.ended_on is null and t.parent_tenancy_id is null
      where p.id = $1
      order by t.started_on desc
      limit 1`,
    [propertyId],
  );

  const r = rows[0];
  if (!r) return null;

  return {
    bedrooms: r.bedrooms,
    furnished: r.furnished,
    has_gas: r.has_gas,
    licence_kind: r.licence_kind,
    licence_number: r.licence_number,
    property_manager_name: r.property_manager_name,
    property_manager_email: r.property_manager_email,
    freeholder_name: r.freeholder_name,
    freeholder_email: r.freeholder_email,
    superior_landlord_name: r.superior_landlord_name,
    ...(r.rent_pennies !== null ? { rent_pennies: r.rent_pennies } : {}),
    ...(r.rent_frequency !== null ? { rent_frequency: r.rent_frequency } : {}),
    ...(r.bills_included !== null ? { bills_included: r.bills_included } : {}),
    ...(r.households !== null ? { households: r.households } : {}),
    ...(r.occupants !== null ? { occupants: r.occupants } : {}),
    gas_certificate_issued_on: r.gas_certificate_issued_on,
  };
}

/**
 * Compare a registered property against its snapshot and open drift items.
 *
 * Idempotent: a field that already has an open item is left alone, so running
 * this on every save (or on a cron) does not reset anyone's clock or pile up
 * duplicates. That matters — a duplicated item would show the landlord two
 * deadlines for one thing.
 */
export async function reconcileDrift(
  ctx: AccountContext,
  propertyId: string,
  changedOn: string,
): Promise<{ opened: number; fields: DriftField[] }> {
  return withAccount(ctx, async (client) => {
    const registration = await client.query<{ id: string; status: string }>(
      "select id, status::text as status from live_registrations where property_id = $1",
      [propertyId],
    );
    const reg = registration.rows[0];
    // Nothing to drift from until the property is actually on the register.
    if (!reg || reg.status !== "active") return { opened: 0, fields: [] };

    const snapshotRow = await client.query<{ facts: RegisteredFacts }>(
      `select facts from live_register_snapshots
        where registration_id = $1 order by confirmed_at desc limit 1`,
      [reg.id],
    );
    const snapshot = snapshotRow.rows[0]?.facts;
    if (!snapshot) return { opened: 0, fields: [] };

    const current = await currentRegisteredFacts(client, propertyId);
    if (!current) return { opened: 0, fields: [] };

    const openRows = await client.query<{ field: string }>(
      `select field from live_drift_items
        where registration_id = $1 and closed_at is null`,
      [reg.id],
    );
    const alreadyOpen = new Set(openRows.rows.map((r) => r.field));

    const diffs = diffRegisteredFacts(snapshot, current).filter((d) => !alreadyOpen.has(d.field));
    const items = openDriftItems(diffs, changedOn);

    for (const item of items) {
      await client.query(
        `insert into drift_items
           (account_id, registration_id, field, field_label, old_value, new_value, opened_at, due_on)
         values ($1, $2, $3, $4, $5, $6, now(), $7::date)`,
        [ctx.accountId, reg.id, item.field, item.field_label, item.old_value, item.new_value, item.due_on],
      );
      await appendLedger(client, ctx.accountId, "drift.opened", {
        property_id: propertyId,
        field: item.field,
        old_value: item.old_value,
        new_value: item.new_value,
        due_on: item.due_on,
      });
    }

    return { opened: items.length, fields: items.map((i) => i.field as DriftField) };
  });
}

export type OpenDriftRow = {
  id: string;
  property_id: string;
  property_label: string;
  field: DriftField;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  due_on: string;
  status: DriftStatus;
};

export async function listOpenDrift(ctx: AccountContext, today: string): Promise<OpenDriftRow[]> {
  return withAccount(ctx, async (client) => {
    const { rows } = await client.query<{
      id: string; property_id: string; line1: string; town: string | null; postcode: string;
      field: DriftField; field_label: string; old_value: string | null; new_value: string | null;
      due_on: string;
    }>(
      `select d.id, r.property_id, p.line1, p.town, p.postcode,
              d.field, d.field_label, d.old_value, d.new_value,
              to_char(d.due_on, 'YYYY-MM-DD') as due_on
         from live_drift_items d
         join live_registrations r on r.id = d.registration_id
         join live_properties p on p.id = r.property_id
        where d.closed_at is null
        order by d.due_on asc`,
    );

    return rows.map((r) => ({
      id: r.id,
      property_id: r.property_id,
      property_label: [r.line1, r.town, r.postcode].filter(Boolean).join(", "),
      field: r.field,
      field_label: r.field_label,
      old_value: r.old_value,
      new_value: r.new_value,
      due_on: r.due_on,
      status: driftStatus({ due_on: r.due_on }, today),
    }));
  });
}

/**
 * The landlord says they have updated GOV.UK.
 *
 * Closes the named items and advances the snapshot for exactly those fields —
 * a field that changed again while they were updating keeps its own, later
 * clock rather than being swept up in this confirmation.
 */
export async function confirmUpdated(
  ctx: AccountContext,
  driftItemIds: string[],
  evidenceDocumentId: string | null,
): Promise<{ closed: number }> {
  if (driftItemIds.length === 0) return { closed: 0 };

  return withAccount(ctx, async (client) => {
    const { rows: items } = await client.query<{
      id: string; registration_id: string; field: DriftField; property_id: string;
    }>(
      `select d.id, d.registration_id, d.field, r.property_id
         from live_drift_items d
         join live_registrations r on r.id = d.registration_id
        where d.id = any($1::uuid[]) and d.closed_at is null`,
      [driftItemIds],
    );
    if (items.length === 0) return { closed: 0 };

    const registrationId = items[0]!.registration_id;
    const propertyId = items[0]!.property_id;

    const snapshotRow = await client.query<{ facts: RegisteredFacts }>(
      `select facts from live_register_snapshots
        where registration_id = $1 order by confirmed_at desc limit 1`,
      [registrationId],
    );
    const snapshot = snapshotRow.rows[0]?.facts ?? {};
    const current = (await currentRegisteredFacts(client, propertyId)) ?? {};

    const next = advanceSnapshot(snapshot, current, items.map((i) => i.field));

    await client.query(
      "insert into register_snapshots (account_id, registration_id, facts) values ($1, $2, $3::jsonb)",
      [ctx.accountId, registrationId, JSON.stringify(next)],
    );

    await client.query(
      `update drift_items set closed_at = now(), evidence_document_id = $2, updated_at = now()
        where id = any($1::uuid[])`,
      [items.map((i) => i.id), evidenceDocumentId],
    );

    for (const item of items) {
      await appendLedger(client, ctx.accountId, "drift.closed", {
        property_id: propertyId,
        field: item.field,
        evidence_document_id: evidenceDocumentId,
      });
    }

    return { closed: items.length };
  });
}

/** Record the initial snapshot when a property is first registered. */
export async function recordRegistration(
  ctx: AccountContext,
  propertyId: string,
  input: { propertyRegistrationNumber: string; registeredOn: string; renewalDueOn: string },
): Promise<void> {
  await withAccount(ctx, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into registrations
         (account_id, property_id, property_registration_number, registered_on, renewal_due_on, status)
       values ($1, $2, $3, $4::date, $5::date, 'active')
       on conflict (property_id) do update
         set property_registration_number = excluded.property_registration_number,
             registered_on = excluded.registered_on,
             renewal_due_on = excluded.renewal_due_on,
             status = 'active',
             updated_at = now()
       returning id`,
      [ctx.accountId, propertyId, input.propertyRegistrationNumber, input.registeredOn, input.renewalDueOn],
    );
    const registrationId = rows[0]!.id;

    // The snapshot is what we believe the government entry now says. Taking it
    // at the moment of registration is what makes every later change a drift.
    const facts = (await currentRegisteredFacts(client, propertyId)) ?? {};
    await client.query(
      "insert into register_snapshots (account_id, registration_id, facts) values ($1, $2, $3::jsonb)",
      [ctx.accountId, registrationId, JSON.stringify(facts)],
    );

    await appendLedger(client, ctx.accountId, "registration.recorded", {
      property_id: propertyId,
      property_registration_number: input.propertyRegistrationNumber,
      registered_on: input.registeredOn,
      renewal_due_on: input.renewalDueOn,
    });
  });
}
