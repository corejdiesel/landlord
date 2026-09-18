/**
 * Demo seed: the four personas from the spec.
 *
 * Deliberately not "three identical landlords with different names". Each one
 * exercises a different part of the product, and between them they cover the
 * cases most likely to be got wrong:
 *
 *  1. Sylvia   — accidental landlord, one London leasehold flat, everything in
 *                order. The calm baseline: nothing should be shouting.
 *  2. The Okonjos — joint owners, two properties in two regions, so the
 *                earliest deadline is the one that bites and each of them needs
 *                their own landlord entry.
 *  3. Brightside Property Ltd — company landlord with a licensed HMO, an
 *                unsatisfactory EICR, and a registered property whose rent has
 *                changed since registration: an open drift item.
 *  4. Kerr & Co — a letting agent with client landlords and live grants.
 */
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { scrypt as scryptCb, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://letsorted:letsorted@127.0.0.1:5432/letsorted";

/** Everything is dated relative to this so the demo reads the same every run. */
const TODAY = process.env.TIME_TRAVEL_DATE ?? "2027-01-20";

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function ctx(client: Client, accountId: string, userId: string) {
  await client.query("select set_config('app.current_account_id', $1, false)", [accountId]);
  await client.query("select set_config('app.current_user_id', $1, false)", [userId]);
  await client.query("select set_config('app.is_admin', 'false', false)");
}

async function clearCtx(client: Client) {
  await client.query("select set_config('app.current_account_id', '', false)");
  await client.query("select set_config('app.current_user_id', '', false)");
}

type Account = { accountId: string; userId: string };

async function createAccount(
  client: Client, email: string, name: string, accountName: string,
  type: "landlord" | "agent", isAdmin = false,
): Promise<Account> {
  await clearCtx(client);
  const { rows } = await client.query<{ account_id: string; user_id: string }>(
    "select account_id, user_id from app_signup($1, $2, $3, $4::account_type)",
    [email, name, accountName, type],
  );
  const { account_id: accountId, user_id: userId } = rows[0]!;
  await client.query("select app_set_password($1, $2)", [userId, await hashPassword("demo-password-123")]);
  if (isAdmin) {
    // Only route to set is_admin; there is no UI for it by design.
    await client.query("select set_config('app.bootstrap', 'on', false)");
    await client.query("update users set is_admin = true where id = $1", [userId]);
    await client.query("select set_config('app.bootstrap', 'off', false)");
  }
  return { accountId, userId };
}

async function seed(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    await client.query("begin");

    // ---------------------------------------------------------------------
    // 1. Sylvia — accidental landlord, one London flat, compliant
    // ---------------------------------------------------------------------
    const sylvia = await createAccount(client, "sylvia@example.test", "Sylvia Hart", "Sylvia Hart", "landlord");
    await ctx(client, sylvia.accountId, sylvia.userId);

    const sylviaEntity = await insertEntity(client, sylvia.accountId, "Sylvia Hart", "individual");
    const flat = await insertProperty(client, sylvia.accountId, {
      line1: "Flat 4, 18 Everleigh House", town: "London", postcode: "SW9 8JT",
      region: "london", type: "flat", ownership: "leasehold", bedrooms: 2, storeys: 1,
      hasGas: true, hmo: false, licence: "none_needed",
    });
    await linkLandlord(client, flat, sylviaEntity, sylvia.accountId, true);
    await insertTenancy(client, sylvia.accountId, flat, {
      startedOn: "2025-09-01", rentPennies: "185000", households: 1, occupants: 2,
      depositTaken: true, depositPennies: "213400",
      depositProtectedOn: "2025-09-08", prescribedInfoOn: "2025-09-08",
      rightToRentOn: "2025-08-20", alarmsTestedOn: "2025-09-01",
    });
    await insertDocument(client, sylvia.accountId, flat, {
      kind: "gas_safety_record", issuedOn: "2026-08-14", expiresOn: "2027-08-14", outcome: "satisfactory",
    });
    await insertDocument(client, sylvia.accountId, flat, {
      kind: "eicr", issuedOn: "2023-05-02", expiresOn: "2028-05-02", outcome: "satisfactory",
    });
    await insertDocument(client, sylvia.accountId, flat, {
      kind: "epc", issuedOn: "2019-11-20", expiresOn: "2029-11-20", outcome: "not_applicable", epcRating: "C",
    });

    // ---------------------------------------------------------------------
    // 2. The Okonjos — joint owners, two regions
    // ---------------------------------------------------------------------
    const okonjo = await createAccount(client, "ade@example.test", "Ade Okonjo", "Ade & Nkem Okonjo", "landlord");
    await ctx(client, okonjo.accountId, okonjo.userId);

    const ade = await insertEntity(client, okonjo.accountId, "Ade Okonjo", "individual");
    const nkem = await insertEntity(client, okonjo.accountId, "Nkem Okonjo", "individual");

    // West Midlands: the earliest deadline in the whole rollout.
    const birmingham = await insertProperty(client, okonjo.accountId, {
      line1: "12 Acacia Road", town: "Birmingham", postcode: "B13 9QT",
      region: "west_midlands", type: "terraced", ownership: "freehold", bedrooms: 3, storeys: 2,
      hasGas: true, hmo: false, licence: "none_needed",
    });
    await linkLandlord(client, birmingham, ade, okonjo.accountId, true);
    await linkLandlord(client, birmingham, nkem, okonjo.accountId, false);
    await insertTenancy(client, okonjo.accountId, birmingham, {
      startedOn: "2024-04-01", rentPennies: "125000", households: 1, occupants: 4,
      depositTaken: true, depositPennies: "144200",
      depositProtectedOn: "2024-04-10", prescribedInfoOn: "2024-04-10",
      rightToRentOn: "2024-03-22", alarmsTestedOn: "2024-04-01",
    });
    // Gas certificate that has just expired — the most common real failure.
    await insertDocument(client, okonjo.accountId, birmingham, {
      kind: "gas_safety_record", issuedOn: "2025-12-02", expiresOn: "2026-12-02", outcome: "satisfactory",
    });
    await insertDocument(client, okonjo.accountId, birmingham, {
      kind: "epc", issuedOn: "2018-06-11", expiresOn: "2028-06-11", outcome: "not_applicable", epcRating: "D",
    });

    const leeds = await insertProperty(client, okonjo.accountId, {
      line1: "5 Hollybank Terrace", town: "Leeds", postcode: "LS6 2QL",
      region: "yorkshire_and_the_humber", type: "semi_detached", ownership: "freehold",
      bedrooms: 4, storeys: 2, hasGas: true, hmo: false, licence: "none_needed",
    });
    await linkLandlord(client, leeds, ade, okonjo.accountId, true);
    await linkLandlord(client, leeds, nkem, okonjo.accountId, false);
    await insertTenancy(client, okonjo.accountId, leeds, {
      startedOn: "2026-02-01", rentPennies: "110000", households: 1, occupants: 3,
      depositTaken: true, depositPennies: "126900",
      depositProtectedOn: "2026-02-12", prescribedInfoOn: null, // deliberately missing
      rightToRentOn: "2026-01-25", alarmsTestedOn: "2026-02-01",
    });

    // ---------------------------------------------------------------------
    // 3. Brightside Property Ltd — company, HMO, unsatisfactory EICR, drift
    // ---------------------------------------------------------------------
    const brightside = await createAccount(client, "ops@brightside.test", "Dawn Reilly", "Brightside Property Ltd", "landlord");
    await ctx(client, brightside.accountId, brightside.userId);

    const company = await insertEntity(client, brightside.accountId, "Brightside Property Ltd", "company", "09876543");
    const hmo = await insertProperty(client, brightside.accountId, {
      line1: "88 Wellington Street", town: "Manchester", postcode: "M14 5TP",
      region: "north_west", type: "terraced", ownership: "freehold", bedrooms: 5, storeys: 3,
      hasGas: true, hmo: true, licence: "hmo_mandatory", licenceNumber: "HMO/2024/0912",
      licenceExpiresOn: "2029-03-31",
    });
    await linkLandlord(client, hmo, company, brightside.accountId, true);
    await insertTenancy(client, brightside.accountId, hmo, {
      startedOn: "2025-07-01", rentPennies: "260000", households: 5, occupants: 5,
      depositTaken: true, depositPennies: "300000",
      depositProtectedOn: "2025-07-05", prescribedInfoOn: "2025-07-05",
      rightToRentOn: "2025-06-20", alarmsTestedOn: "2025-07-01",
    });
    await insertDocument(client, brightside.accountId, hmo, {
      kind: "gas_safety_record", issuedOn: "2026-10-05", expiresOn: "2027-10-05", outcome: "satisfactory",
    });
    // Unsatisfactory EICR: opens a 28-day remedial obligation.
    await insertDocument(client, brightside.accountId, hmo, {
      kind: "eicr", issuedOn: addDays(TODAY, -20), expiresOn: addDays(TODAY, 1800), outcome: "unsatisfactory",
    });
    await insertDocument(client, brightside.accountId, hmo, {
      kind: "epc", issuedOn: "2021-03-08", expiresOn: "2031-03-08", outcome: "not_applicable", epcRating: "D",
    });

    // Registered, with a snapshot — then the rent changed. That is a drift item.
    const registeredOn = addDays(TODAY, -40);
    const regId = randomUUID();
    await client.query(
      `insert into registrations (id, account_id, property_id, property_registration_number,
                                  registered_on, renewal_due_on, status)
       values ($1, $2, $3, $4, $5::date, $6::date, 'active')`,
      [regId, brightside.accountId, hmo, "PRP-8842-1190", registeredOn, addDays(registeredOn, 365)],
    );
    // The snapshot records the rent as it was at registration: £2,500.
    await client.query(
      `insert into register_snapshots (account_id, registration_id, facts, confirmed_at)
       values ($1, $2, $3::jsonb, $4::timestamptz)`,
      [brightside.accountId, regId, JSON.stringify({
        bedrooms: 5, furnished: "part_furnished", has_gas: true,
        licence_kind: "hmo_mandatory", licence_number: "HMO/2024/0912",
        property_manager_name: null, property_manager_email: null,
        freeholder_name: null, freeholder_email: null, superior_landlord_name: null,
        rent_pennies: "250000", rent_frequency: "monthly", bills_included: false,
        households: 5, occupants: 5,
        gas_certificate_issued_on: "2026-10-05",
      }), `${registeredOn}T10:00:00Z`],
    );
    // The rent is now £2,600 in our records, so one field has drifted.
    const rentChangedOn = addDays(TODAY, -8);
    await client.query(
      "update tenancies set rent_pennies = 260000 where property_id = $1", [hmo],
    );
    await client.query(
      `insert into drift_items (account_id, registration_id, field, field_label,
                                old_value, new_value, opened_at, due_on)
       values ($1, $2, 'rent_pennies', 'Rent', '250000', '260000', $3::timestamptz, $4::date)`,
      [brightside.accountId, regId, `${rentChangedOn}T09:00:00Z`, addDays(rentChangedOn, 28)],
    );
    await client.query("select ledger_append($1, 'registration.recorded', $2::jsonb)", [
      brightside.accountId, JSON.stringify({ property_id: hmo, property_registration_number: "PRP-8842-1190" }),
    ]);
    await client.query("select ledger_append($1, 'drift.opened', $2::jsonb)", [
      brightside.accountId,
      JSON.stringify({ property_id: hmo, field: "rent_pennies", old_value: "250000", new_value: "260000" }),
    ]);

    // ---------------------------------------------------------------------
    // 4. Kerr & Co — a letting agent with client landlords
    // ---------------------------------------------------------------------
    const agent = await createAccount(client, "hello@kerrandco.test", "Marie Kerr", "Kerr & Co Lettings", "agent", true);

    // The GRANT is created by the landlord, never by the agent. Seeding it any
    // other way would not survive the RLS policy, which is the point.
    for (const landlord of [sylvia, okonjo, brightside]) {
      await ctx(client, landlord.accountId, landlord.userId);
      await client.query(
        `insert into agent_grants (agent_account_id, landlord_account_id) values ($1, $2)
         on conflict do nothing`,
        [agent.accountId, landlord.accountId],
      );
    }

    // ---------------------------------------------------------------------
    // Law Watch sources — the spec's initial watch list
    // ---------------------------------------------------------------------
    await ctx(client, agent.accountId, agent.userId);
    await client.query("select set_config('app.is_admin', 'true', false)");
    const sources: [string, string][] = [
      ["GOV.UK Housing Hub — Get ready to register", "https://housinghub.campaign.gov.uk/renting-is-changing/get-ready-to-register/"],
      ["GOV.UK news, 9 Sept 2026", "https://www.gov.uk/government/news/stronger-protections-and-greater-confidence-for-renters"],
      ["Draft PRS Database Regulations 2026", "https://www.legislation.gov.uk/ukdsi/2026/9780348286861/data.pdf"],
      ["Explanatory Memorandum", "https://www.legislation.gov.uk/ukdsi/2026/9780348286861/pdfs/ukdsiem_9780348286861_en_001.pdf"],
      ["Renters' Rights Act 2025, Part 2 Chapter 3", "https://www.legislation.gov.uk/ukpga/2025/26/part/2/chapter/3/enacted"],
    ];
    for (const [label, url] of sources) {
      await client.query(
        "insert into law_watch_sources (label, url) values ($1, $2) on conflict (url) do nothing",
        [label, url],
      );
    }

    await client.query("commit");

    console.log("Seeded four personas. Sign in with any of these, password: demo-password-123");
    console.log("  sylvia@example.test      one London flat, everything in order");
    console.log("  ade@example.test         joint owners, two regions, a lapsed gas certificate");
    console.log("  ops@brightside.test      company, licensed HMO, unsatisfactory EICR, an open drift item");
    console.log("  hello@kerrandco.test     letting agent with three client landlords (also admin)");
    console.log(`\nDemo date is ${TODAY}. Run with TIME_TRAVEL_DATE to move it.`);
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}

// --- small insert helpers -------------------------------------------------

async function insertEntity(
  client: Client, accountId: string, name: string,
  type: "individual" | "company" | "trust" | "representative", companyNumber?: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into landlord_entities (account_id, entity_type, name, companies_house_number,
                                    correspondence_line1, correspondence_town, correspondence_postcode, email)
     values ($1, $2::entity_type, $3, $4, $5, $6, $7, $8) returning id`,
    [accountId, type, name, companyNumber ?? null,
     "1 Correspondence Way", "Birmingham", "B1 1AA", `${name.split(" ")[0]!.toLowerCase()}@example.test`],
  );
  return rows[0]!.id;
}

async function insertProperty(
  client: Client, accountId: string,
  p: {
    line1: string; town: string; postcode: string; region: string; type: string;
    ownership: string; bedrooms: number; storeys: number; hasGas: boolean; hmo: boolean;
    licence: string; licenceNumber?: string; licenceExpiresOn?: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into properties (account_id, line1, town, postcode, itl1_region, type, ownership,
                             bedrooms, storeys, furnished, has_gas, has_fixed_combustion_appliance,
                             hmo, licence_kind, licence_number, licence_expires_on, is_let)
     values ($1,$2,$3,$4,$5::itl1_region,$6::property_type,$7::ownership_type,$8,$9,
             'part_furnished',$10,$10,$11,$12::licence_kind,$13,$14::date,true)
     returning id`,
    [accountId, p.line1, p.town, p.postcode, p.region, p.type, p.ownership, p.bedrooms,
     p.storeys, p.hasGas, p.hmo, p.licence, p.licenceNumber ?? null, p.licenceExpiresOn ?? null],
  );
  return rows[0]!.id;
}

async function linkLandlord(
  client: Client, propertyId: string, entityId: string, accountId: string, isLead: boolean,
): Promise<void> {
  await client.query(
    `insert into property_landlords (property_id, landlord_entity_id, account_id, is_lead)
     values ($1, $2, $3, $4) on conflict do nothing`,
    [propertyId, entityId, accountId, isLead],
  );
}

async function insertTenancy(
  client: Client, accountId: string, propertyId: string,
  t: {
    startedOn: string; rentPennies: string; households: number; occupants: number;
    depositTaken: boolean; depositPennies: string;
    depositProtectedOn: string | null; prescribedInfoOn: string | null;
    rightToRentOn: string | null; alarmsTestedOn: string | null;
  },
): Promise<void> {
  await client.query(
    `insert into tenancies (account_id, property_id, kind, started_on, rent_pennies, rent_frequency,
                            bills_included, households, occupants, deposit_taken, deposit_pennies,
                            deposit_scheme, deposit_protected_on, prescribed_information_served_on,
                            right_to_rent_checked_on, alarms_tested_on)
     values ($1,$2,'assured',$3::date,$4,'monthly',false,$5,$6,$7,$8,'mydeposits',
             $9::date,$10::date,$11::date,$12::date)`,
    [accountId, propertyId, t.startedOn, t.rentPennies, t.households, t.occupants,
     t.depositTaken, t.depositPennies, t.depositProtectedOn, t.prescribedInfoOn,
     t.rightToRentOn, t.alarmsTestedOn],
  );
}

async function insertDocument(
  client: Client, accountId: string, propertyId: string,
  d: { kind: string; issuedOn: string; expiresOn: string; outcome: string; epcRating?: string },
): Promise<void> {
  await client.query(
    `insert into documents (account_id, property_id, kind, issued_on, expires_on, outcome,
                            epc_rating, confirmed_at, sha256, original_filename)
     values ($1,$2,$3::document_kind,$4::date,$5::date,$6::document_outcome,$7,now(),$8,$9)`,
    [accountId, propertyId, d.kind, d.issuedOn, d.expiresOn, d.outcome, d.epcRating ?? null,
     randomUUID().replace(/-/g, "").padEnd(64, "0"), `${d.kind}-${d.issuedOn}.pdf`],
  );
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
