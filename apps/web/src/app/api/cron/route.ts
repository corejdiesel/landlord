import { NextResponse } from "next/server";
import { withoutAccount } from "../../../lib/db";
import { runReminders } from "../../../lib/reminders";
import { reconcileDrift } from "../../../lib/drift-service";
import { today } from "../../../lib/env";

/**
 * Cron entry point.
 *
 * Every job behind it is idempotent, so a double-fire is harmless — which is the
 * only safe assumption to make about a scheduler you do not control.
 *
 * Protected by a shared secret rather than a session: there is no user here. In
 * this build there is no scheduler either, so it is called by hand or by a test.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  // With no secret configured this is local-only, so it runs; in any deployment
  // a missing secret must fail closed rather than leave the endpoint open.
  if (secret && provided !== secret) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  if (!secret && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  const now = today();

  // Each account is processed in its own transaction, so one failure does not
  // stop everyone else's reminders going out.
  const accounts = await withoutAccount(async (client) => {
    await client.query("select set_config('app.bootstrap', 'on', false)");
    const { rows } = await client.query<{ account_id: string; user_id: string }>(
      `select m.account_id, m.user_id from memberships m
        where m.role = 'owner' and m.deleted_at is null`,
    );
    await client.query("select set_config('app.bootstrap', 'off', false)");
    return rows;
  });

  const results: { account_id: string; scheduled?: number; sent?: number; error?: string }[] = [];

  for (const account of accounts) {
    const ctx = { accountId: account.account_id, userId: account.user_id };
    try {
      const properties = await withoutAccount(async (client) => {
        await client.query("select set_config('app.current_account_id', $1, false)", [ctx.accountId]);
        await client.query("select set_config('app.current_user_id', $1, false)", [ctx.userId]);
        const { rows } = await client.query<{ id: string }>("select id from live_properties");
        return rows.map((r) => r.id);
      });
      for (const propertyId of properties) {
        await reconcileDrift(ctx, propertyId, now);
      }

      const { scheduled, sent } = await runReminders(ctx, now);
      results.push({ account_id: ctx.accountId, scheduled, sent });
    } catch (err) {
      results.push({ account_id: ctx.accountId, error: (err as Error).message });
    }
  }

  return NextResponse.json({ ran_for: now, accounts: results.length, results });
}
