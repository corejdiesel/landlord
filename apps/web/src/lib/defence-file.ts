import { formatUkLong } from "@letsorted/rules";
import { verifyLedger, withAccount, type AccountContext } from "./db";

/**
 * The Defence File.
 *
 * A chronological, plain-English record of what a landlord did and when, with
 * document fingerprints and a page explaining how the chain can be checked.
 *
 * On what this is careful NOT to claim: councils must be satisfied to the
 * criminal standard before issuing a penalty, and a landlord who can show a
 * dated trail of diligence is in a materially better position. But this is a
 * record, not a defence in the legal sense, and the copy says "a clear record
 * of what you did and when" — never "this will protect you".
 */

export type DefenceEvent = {
  seq: string;
  at: string;
  type: string;
  /** Plain English, written for someone who has never seen this software. */
  description: string;
  payload: Record<string, unknown>;
  hash: string;
  prev_hash: string;
};

export type DefenceFile = {
  account_name: string;
  property_label: string | null;
  generated_on: string;
  events: DefenceEvent[];
  /** Empty when the chain verifies. Each entry names where it broke. */
  problems: { seq: string; problem: string }[];
  chain_intact: boolean;
  first_hash: string | null;
  last_hash: string | null;
};

/** Turn a ledger row into a sentence a council officer could read. */
export function describeEvent(type: string, payload: Record<string, unknown>): string {
  const str = (key: string) => (typeof payload[key] === "string" ? (payload[key] as string) : null);

  switch (type) {
    case "property.added":
      return `Property added to the account (${str("postcode") ?? "address recorded"}).`;
    case "tenancy.saved":
      return "Letting details recorded or updated.";
    case "document.uploaded":
      return `Document uploaded: ${str("filename") ?? "file"}${
        str("via") === "inbound_email" ? ", forwarded by email" : ""
      }. Fingerprint ${(str("sha256") ?? "").slice(0, 16)}…`;
    case "document.confirmed": {
      const kind = str("kind") ?? "document";
      const expires = str("expires_on");
      return `${humanKind(kind)} confirmed by the landlord${
        expires ? `, valid until ${formatUkLong(expires)}` : ""
      }.`;
    }
    case "registration.recorded":
      return `Registered on the government database. Property registration number ${
        str("property_registration_number") ?? "recorded"
      }.`;
    case "drift.opened":
      return `A registered detail changed (${str("field") ?? "field"}), so the database entry needed updating by ${
        str("due_on") ? formatUkLong(str("due_on")!) : "within 28 days"
      }.`;
    case "drift.closed":
      return `Landlord confirmed the government entry was updated (${str("field") ?? "field"}).`;
    case "remedial.opened":
      return `An unsatisfactory electrical report started a 28-day window for remedial work, due ${
        str("due_on") ? formatUkLong(str("due_on")!) : "within 28 days"
      }.`;
    case "reminder.sent":
      return `Reminder sent by email: "${str("subject") ?? "reminder"}".`;
    case "pulse.answered":
      return "Occupancy check-in answered by the tenant.";
    case "attestation.requested":
      return "Agent asked the landlord to confirm a change.";
    case "attestation.confirmed":
      return "Landlord confirmed the agent's change.";
    case "attestation.disputed":
      return "Landlord disputed the agent's change.";
    case "passport.created":
      return "A tenant-facing property page was published.";
    case "passport.revoked":
      return "The tenant-facing property page was withdrawn.";
    default:
      return type.replace(/[._]/g, " ");
  }
}

function humanKind(kind: string): string {
  switch (kind) {
    case "gas_safety_record": return "Gas safety record";
    case "eicr": return "Electrical safety report";
    case "eic": return "Electrical installation certificate";
    case "epc": return "Energy performance certificate";
    case "licence": return "Licence";
    case "deposit_certificate": return "Deposit certificate";
    default: return "Document";
  }
}

export async function buildDefenceFile(
  ctx: AccountContext,
  today: string,
  propertyId: string | null,
): Promise<DefenceFile> {
  return withAccount(ctx, async (client) => {
    const account = await client.query<{ name: string }>(
      "select name from live_accounts where id = $1", [ctx.accountId],
    );

    let propertyLabel: string | null = null;
    if (propertyId) {
      const { rows } = await client.query<{ line1: string; town: string | null; postcode: string }>(
        "select line1, town, postcode from live_properties where id = $1", [propertyId],
      );
      const p = rows[0];
      propertyLabel = p ? [p.line1, p.town, p.postcode].filter(Boolean).join(", ") : null;
    }

    const { rows } = await client.query<{
      seq: string; at: string; event_type: string;
      payload: Record<string, unknown>; hash: string; prev_hash: string;
    }>(
      `select seq, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as at,
              event_type, payload, hash, prev_hash
         from ledger_events
        where account_id = $1
        order by seq asc`,
      [ctx.accountId],
    );

    // Filtering by property is done here rather than in SQL because the payload
    // shape varies by event type, and a JSON path per type would be brittle.
    const filtered = propertyId
      ? rows.filter((r) => {
          const pid = r.payload["property_id"];
          // Account-level events (reminders, attestations) belong in every file.
          return pid === undefined || pid === propertyId;
        })
      : rows;

    const problems = await verifyLedger(client, ctx.accountId);

    return {
      account_name: account.rows[0]?.name ?? "Account",
      property_label: propertyLabel,
      generated_on: today,
      events: filtered.map((r) => ({
        seq: r.seq,
        at: r.at,
        type: r.event_type,
        description: describeEvent(r.event_type, r.payload),
        payload: r.payload,
        hash: r.hash,
        prev_hash: r.prev_hash,
      })),
      problems,
      chain_intact: problems.length === 0,
      first_hash: rows[0]?.hash ?? null,
      last_hash: rows.at(-1)?.hash ?? null,
    };
  });
}
