import { addDays } from "@letsorted/rules";
import { adapters } from "../adapters/index";
import { appendLedger, withAccount, withoutAccount, type AccountContext } from "./db";
import { reconcileDrift } from "./drift-service";
import { hashToken, newToken } from "./tokens";

/**
 * Household Pulse.
 *
 * The register wants the number of households and occupants kept current, and
 * a landlord has no natural way to know. So we ask the tenant — two numbers,
 * one tap, and nothing else collected.
 *
 * The privacy position is the product here: a landlord anxious about what the
 * government database exposes should find us visibly better behaved than the
 * thing they are anxious about. So the response table holds two integers and a
 * timestamp, and nothing that could identify a person. If you are adding a
 * column to pulse_responses, stop.
 */

export const PULSE_LINK_DAYS = 30;

export async function createPulseRequest(
  ctx: AccountContext,
  propertyId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + PULSE_LINK_DAYS * 86_400_000);

  await withAccount(ctx, async (client) => {
    await client.query(
      `insert into pulse_requests (account_id, property_id, token_hash, expires_at)
       values ($1, $2, $3, $4)`,
      [ctx.accountId, propertyId, hashToken(token, "pulse"), expiresAt],
    );
    await appendLedger(client, ctx.accountId, "pulse.requested", {
      property_id: propertyId,
      expires_at: expiresAt.toISOString(),
    });
  });

  return { token, expiresAt };
}

export type PulseLookup =
  | { ok: true; requestId: string; alreadyAnswered: boolean }
  | { ok: false; reason: "invalid" | "expired" | "answered" };

/**
 * Resolve a pulse link for an anonymous visitor.
 *
 * Goes through a SECURITY DEFINER function that returns only what the page
 * needs. No table is readable anonymously, and the response deliberately does
 * not include the address: a leaked link should not reveal where someone lives.
 */
export async function lookupPulse(token: string): Promise<PulseLookup> {
  if (!token || token.length < 20) return { ok: false, reason: "invalid" };

  return withoutAccount(async (client) => {
    const { rows } = await client.query<{
      id: string; property_id: string; expires_at: string; already_answered: boolean;
    }>("select id, property_id, expires_at, already_answered from public_pulse_request($1)",
       [hashToken(token, "pulse")]);

    const row = rows[0];
    if (!row) return { ok: false as const, reason: "invalid" as const };
    if (row.already_answered) return { ok: false as const, reason: "answered" as const };
    return { ok: true as const, requestId: row.id, alreadyAnswered: false };
  });
}

export type PulseAnswerResult = { ok: true } | { ok: false; error: string };

/**
 * Record a tenant's answer.
 *
 * Validated at both ends: here for a friendly message, and inside the database
 * function for the guarantee, since this is reachable without a session.
 */
export async function answerPulse(
  token: string,
  households: number,
  occupants: number,
): Promise<PulseAnswerResult> {
  if (!Number.isInteger(households) || households < 0 || households > 50) {
    return { ok: false, error: "That number of households does not look right." };
  }
  if (!Number.isInteger(occupants) || occupants < 0 || occupants > 200) {
    return { ok: false, error: "That number of people does not look right." };
  }
  if (occupants < households) {
    return { ok: false, error: "There cannot be fewer people than households." };
  }

  try {
    await withoutAccount(async (client) => {
      await client.query("select public_pulse_answer($1, $2, $3)", [
        hashToken(token, "pulse"), households, occupants,
      ]);
    });
    return { ok: true };
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("already answered")) {
      return { ok: false, error: "That link has already been used. Thank you." };
    }
    if (message.includes("invalid or expired")) {
      return { ok: false, error: "That link is no longer valid. Ask your landlord for a new one." };
    }
    return { ok: false, error: "We could not save that. Please try again." };
  }
}

/**
 * Fold answered check-ins into the tenancy.
 *
 * A changed answer is a change to a registered fact, so it opens a drift item
 * like any other — which is the whole reason for asking.
 */
export async function applyPulseResponses(
  ctx: AccountContext,
  today: string,
): Promise<{ applied: number }> {
  const pending = await withAccount(ctx, async (client) => {
    const { rows } = await client.query<{
      response_id: string; property_id: string; households: number; occupants: number;
    }>(
      `select r.id as response_id, q.property_id, r.households, r.occupants
         from live_pulse_responses r
         join live_pulse_requests q on q.id = r.pulse_request_id
        order by r.answered_at asc`,
    );
    return rows;
  });

  let applied = 0;

  for (const response of pending) {
    const changed = await withAccount(ctx, async (client) => {
      const { rowCount } = await client.query(
        `update tenancies
            set households = $2, occupants = $3, updated_at = now()
          where property_id = $1 and ended_on is null and parent_tenancy_id is null
            and (households <> $2 or occupants <> $3)`,
        [response.property_id, response.households, response.occupants],
      );
      if (rowCount && rowCount > 0) {
        await appendLedger(client, ctx.accountId, "pulse.answered", {
          property_id: response.property_id,
          households: response.households,
          occupants: response.occupants,
        });
        return true;
      }
      return false;
    });

    if (changed) {
      await reconcileDrift(ctx, response.property_id, today);
      applied++;
    }
  }

  return { applied };
}

/** Email a check-in link. Uses the mail catcher in this build. */
export async function sendPulseInvite(
  ctx: AccountContext,
  propertyLabel: string,
  tenantEmail: string,
  token: string,
  appUrl: string,
): Promise<{ ok: boolean }> {
  const { email } = adapters();
  const link = `${appUrl}/check-in/${token}`;

  const result = await email.send({
    to: tenantEmail,
    subject: "A quick question about your home",
    text: [
      `Your landlord has to tell the government how many people live at ${propertyLabel}.`,
      "",
      "It is two numbers and one tap. We do not ask for your name, and we do not",
      "store anything else about you.",
      "",
      link,
      "",
      `This link works until ${addDays(new Date().toISOString().slice(0, 10), PULSE_LINK_DAYS)}.`,
    ].join("\n"),
  });

  return { ok: result.ok };
}
