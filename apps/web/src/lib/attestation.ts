import { appendLedger, withAccount, withoutAccount, type AccountContext } from "./db";
import { hashToken, newToken } from "./tokens";

/**
 * Agent Attestation.
 *
 * An agent may supply information on a landlord's behalf, but the landlord
 * remains responsible for it — so every agent-prepared change produces a one-tap
 * confirmation request to the landlord, and the answer is written to BOTH
 * parties' ledgers.
 *
 * That last point is the whole design. If only the agent's record showed the
 * confirmation, the landlord would have no independent evidence they were asked;
 * if only the landlord's did, the agent could not show they sought approval.
 */

export const ATTESTATION_DAYS = 21;

export type ChangeDescription = {
  property_id: string;
  property_label: string;
  field: string;
  field_label: string;
  old_value: string | null;
  new_value: string | null;
  /** One sentence the landlord can answer without opening anything. */
  sentence: string;
};

export async function requestAttestation(
  agentCtx: AccountContext,
  landlordAccountId: string,
  change: ChangeDescription,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ATTESTATION_DAYS * 86_400_000);

  await withAccount(agentCtx, async (client) => {
    await client.query(
      `insert into attestation_requests
         (agent_account_id, landlord_account_id, property_id, change, token_hash, expires_at)
       values ($1, $2, $3, $4::jsonb, $5, $6)`,
      [agentCtx.accountId, landlordAccountId, change.property_id,
       JSON.stringify(change), hashToken(token, "attestation"), expiresAt],
    );
    await appendLedger(client, agentCtx.accountId, "attestation.requested", {
      landlord_account_id: landlordAccountId,
      property_id: change.property_id,
      field: change.field,
      new_value: change.new_value,
    });
  });

  return { token, expiresAt };
}

export type AttestationLookup =
  | { ok: true; id: string; change: ChangeDescription; agentName: string }
  | { ok: false; reason: "invalid" | "expired" | "answered" };

export async function lookupAttestation(token: string): Promise<AttestationLookup> {
  if (!token || token.length < 20) return { ok: false, reason: "invalid" };

  return withoutAccount(async (client) => {
    await client.query("select set_config('app.bootstrap', 'on', false)");
    try {
      const { rows } = await client.query<{
        id: string; change: ChangeDescription; state: string;
        expires_at: string; agent_name: string;
      }>(
        `select r.id, r.change, r.state::text as state, r.expires_at, a.name as agent_name
           from attestation_requests r
           join accounts a on a.id = r.agent_account_id
          where r.token_hash = $1 and r.deleted_at is null`,
        [hashToken(token, "attestation")],
      );

      const row = rows[0];
      if (!row) return { ok: false as const, reason: "invalid" as const };
      if (row.state !== "pending") return { ok: false as const, reason: "answered" as const };
      if (new Date(row.expires_at) < new Date()) return { ok: false as const, reason: "expired" as const };

      return { ok: true as const, id: row.id, change: row.change, agentName: row.agent_name };
    } finally {
      await client.query("select set_config('app.bootstrap', 'off', false)");
    }
  });
}

export type AttestationAnswer = { ok: true } | { ok: false; error: string };

/**
 * The landlord confirms or disputes.
 *
 * Written to both ledgers, so each party holds independent evidence. Reachable
 * without an account, because requiring one would put a signup between a
 * landlord and a question they need to answer in ten seconds.
 */
export async function answerAttestation(
  token: string,
  decision: "confirmed" | "disputed",
  note: string | null,
): Promise<AttestationAnswer> {
  const lookup = await lookupAttestation(token);
  if (!lookup.ok) {
    return {
      ok: false,
      error: lookup.reason === "answered"
        ? "That has already been answered. Thank you."
        : lookup.reason === "expired"
          ? "That request has expired. Ask your agent to send it again."
          : "That link is not valid.",
    };
  }

  try {
    await withoutAccount(async (client) => {
      await client.query("begin");
      await client.query("select set_config('app.bootstrap', 'on', true)");

      const { rows } = await client.query<{
        agent_account_id: string; landlord_account_id: string; change: ChangeDescription;
      }>(
        `update attestation_requests
            set state = $2::attestation_state, responded_at = now(),
                dispute_note = $3, updated_at = now()
          where token_hash = $1 and state = 'pending'
          returning agent_account_id, landlord_account_id, change`,
        [hashToken(token, "attestation"), decision, note],
      );

      const row = rows[0];
      if (!row) {
        await client.query("rollback");
        throw new Error("already answered");
      }

      const payload = {
        property_id: row.change.property_id,
        field: row.change.field,
        new_value: row.change.new_value,
        decision,
        note,
      };

      // Both ledgers. Neither party can later claim the other's record is the
      // only account of what happened.
      for (const accountId of [row.agent_account_id, row.landlord_account_id]) {
        await client.query("select ledger_append($1, $2, $3::jsonb)", [
          accountId,
          decision === "confirmed" ? "attestation.confirmed" : "attestation.disputed",
          JSON.stringify(payload),
        ]);
      }

      await client.query("commit");
    });
    return { ok: true };
  } catch (err) {
    if ((err as Error).message.includes("already answered")) {
      return { ok: false, error: "That has already been answered. Thank you." };
    }
    return { ok: false, error: "We could not record that. Please try again." };
  }
}
