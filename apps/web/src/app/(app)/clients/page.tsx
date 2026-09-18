import type { Metadata } from "next";
import { formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Money, Status, plural } from "../../../components/ui";
import { requireSession } from "../../../lib/auth";
import { withAccount } from "../../../lib/db";
import { monthlyCostPennies, planFor } from "../../../lib/plans";

export const metadata: Metadata = { title: "Clients" };
export const dynamic = "force-dynamic";

/**
 * The agent workspace.
 *
 * An agent sees a client's data only through an explicit, revocable grant the
 * LANDLORD created — enforced by RLS, not by this page. If a grant is revoked,
 * the rows disappear here whatever the UI does.
 */
export default async function ClientsPage() {
  const session = await requireSession();

  const { account, clients, attestations } = await withAccount(session, async (client) => {
    const { rows: accountRows } = await client.query<{ type: string; plan: string }>(
      "select type::text as type, plan from live_accounts where id = $1", [session.accountId],
    );

    const { rows: clients } = await client.query<{
      landlord_account_id: string; name: string; granted_on: string; property_count: string;
    }>(
      `select g.landlord_account_id, a.name,
              to_char(g.granted_at, 'YYYY-MM-DD') as granted_on,
              (select count(*) from live_properties p where p.account_id = g.landlord_account_id) as property_count
         from live_agent_grants g
         join live_accounts a on a.id = g.landlord_account_id
        where g.agent_account_id = $1
        order by a.name asc`,
      [session.accountId],
    );

    const { rows: attestations } = await client.query<{
      id: string; state: string; created_on: string; responded_on: string | null;
      change: { property_label: string; sentence: string };
    }>(
      `select id, state::text as state, change,
              to_char(created_at, 'YYYY-MM-DD') as created_on,
              to_char(responded_at, 'YYYY-MM-DD') as responded_on
         from live_attestation_requests
        where agent_account_id = $1
        order by created_at desc limit 25`,
      [session.accountId],
    );

    return { account: accountRows[0], clients, attestations };
  });

  if (account?.type !== "agent") {
    return (
      <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
        <h1>Clients</h1>
        <Card className="stack">
          <Status tone="info">For letting agents</Status>
          <p style={{ margin: 0 }}>
            This is the agent workspace. Your account is set up as a landlord, so
            there is nothing here for you.
          </p>
        </Card>
      </div>
    );
  }

  const plan = planFor(account.plan);
  const totalProperties = clients.reduce((sum, c) => sum + Number(c.property_count), 0);

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <h1>Clients</h1>

      <Card className="stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>{plan.name} plan</h2>
          <Status tone="info">
            {totalProperties} of {plan.property_limit ?? "unlimited"} properties
          </Status>
        </div>
        <p style={{ margin: 0 }}>
          <Money pennies={monthlyCostPennies(account.plan, totalProperties)} /> a month
          {plan.overage_pennies_per_property && plan.property_limit
            && totalProperties > plan.property_limit ? (
            <span style={{ color: "var(--ink-muted)" }}>
              {" "}including {totalProperties - plan.property_limit} over your allowance
            </span>
          ) : null}
        </p>
      </Card>

      <section className="stack">
        <h2>Landlords who have given you access</h2>
        {clients.length === 0 ? (
          <Card className="stack">
            <p style={{ margin: 0 }}>
              No landlords have given you access yet. A landlord grants it from their
              own account — you cannot add yourself, by design.
            </p>
          </Card>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {clients.map((c) => (
              <Card as="li" key={c.landlord_account_id} className="stack">
                <div className="spread">
                  <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>{c.name}</h3>
                  <Status tone="ok">Access granted</Status>
                </div>
                <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                  {plural(Number(c.property_count), "property", "properties")} ·
                  since {formatUkLong(c.granted_on)}
                </p>
              </Card>
            ))}
          </ul>
        )}
        <p style={{ color: "var(--ink-muted)", maxWidth: "var(--measure)" }}>
          You can prepare information for these landlords, but they stay responsible
          for it. Anything you change generates a confirmation request to them.
        </p>
      </section>

      <section className="stack">
        <h2>Confirmations</h2>
        {attestations.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Nothing sent yet.</p></Card>
        ) : (
          <table>
            <caption className="visually-hidden">Attestation requests sent to landlords</caption>
            <thead>
              <tr>
                <th scope="col">Sent</th><th scope="col">What</th>
                <th scope="col">Answer</th><th scope="col">When</th>
              </tr>
            </thead>
            <tbody>
              {attestations.map((a) => (
                <tr key={a.id}>
                  <td className="num">{formatUkLong(a.created_on)}</td>
                  <td>{a.change.sentence}</td>
                  <td>
                    <Status tone={
                      a.state === "confirmed" ? "ok"
                      : a.state === "disputed" ? "danger"
                      : a.state === "expired" ? "warn" : "info"
                    }>
                      {a.state === "confirmed" ? "Confirmed"
                        : a.state === "disputed" ? "Disputed"
                        : a.state === "expired" ? "Expired" : "Waiting"}
                    </Status>
                  </td>
                  <td className="num">{a.responded_on ? formatUkLong(a.responded_on) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <LegalFooter />
    </div>
  );
}
