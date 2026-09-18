import { NextResponse } from "next/server";
import { withoutAccount } from "../../../lib/db";
import { icsToken } from "../../../lib/ics-token";
import { buildIcsFeed } from "../../../lib/reminders";
import { today } from "../../../lib/env";

/**
 * Private ICS feed.
 *
 * Reached by an unguessable per-account token rather than a session, because a
 * calendar client cannot sign in. The token is the account's inbound token
 * hashed with a feed-specific salt, so the two cannot be used for each other.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = new URL(request.url).searchParams.get("token");
  if (!token || token.length < 20) {
    return new NextResponse("Not found", { status: 404 });
  }

  const account = await withoutAccount(async (client) => {
    await client.query("select set_config('app.bootstrap', 'on', false)");
    const { rows } = await client.query<{ account_id: string; user_id: string; inbound_token: string }>(
      `select a.id as account_id, m.user_id, a.inbound_token
         from accounts a
         join memberships m on m.account_id = a.id and m.role = 'owner' and m.deleted_at is null
        where a.deleted_at is null`,
    );
    await client.query("select set_config('app.bootstrap', 'off', false)");
    return rows.find((r) => icsToken(r.inbound_token) === token) ?? null;
  });

  if (!account) return new NextResponse("Not found", { status: 404 });

  const ics = await buildIcsFeed(
    { accountId: account.account_id, userId: account.user_id },
    today(),
  );

  return new NextResponse(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="let-sorted.ics"',
      // A calendar client polls this; a short cache spares the database.
      "cache-control": "private, max-age=900",
    },
  });
}

