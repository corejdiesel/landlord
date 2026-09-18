import type { Metadata } from "next";
import Link from "next/link";
import { formatDriftValue, formatUkLong, type Obligation } from "@letsorted/rules";
import { Card, Countdown, LegalFooter, Money, ObligationRow, Status, plural, toneForState } from "../../../components/ui";
import { requireSession } from "../../../lib/auth";
import { withAccount } from "../../../lib/db";
import { evaluateAccount, propertyLabel } from "../../../lib/repository";
import { today } from "../../../lib/env";
import { listOpenDrift } from "../../../lib/drift-service";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

/**
 * The dashboard.
 *
 * Ordered by urgency with one "next best action" at the top. Drift items come
 * first: they are the primary object in this product, because they are the
 * thing with a statutory clock that nobody else is tracking.
 */
export default async function DashboardPage() {
  const session = await requireSession();
  const now = today();

  const [evaluations, drift, account] = await Promise.all([
    evaluateAccount(session, now),
    listOpenDrift(session, now),
    withAccount(session, async (client) => {
      const { rows } = await client.query<{ name: string; calm_mode: boolean }>(
        "select name, calm_mode from live_accounts where id = $1",
        [session.accountId],
      );
      return rows[0] ?? { name: "your account", calm_mode: false };
    }),
  ]);

  const allObligations = evaluations.flatMap((e) => e.obligations);
  const nextAction = pickNextAction(evaluations);
  const exposure = evaluations.reduce((sum, e) => sum + e.exposure_pennies, 0n);
  const attention = allObligations.filter((o) => o.state === "overdue" || o.state === "due_soon");

  if (evaluations.length === 0) {
    return (
      <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
        <h1>Welcome</h1>
        <Card className="stack">
          <h2 style={{ margin: 0 }}>Add your first property</h2>
          <p style={{ margin: 0 }}>
            Once we know where your property is, we can tell you your registration
            window, what you need ready, and what is due when.
          </p>
          <div><Link className="btn" href="/properties/new">Add a property</Link></div>
        </Card>
        <LegalFooter />
      </div>
    );
  }

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <h1>{account.name}</h1>

      {nextAction ? (
        <Card className="stack">
          <p style={{ margin: 0, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: "var(--text-sm)" }}>
            Next best action
          </p>
          <h2 style={{ margin: 0 }}>{nextAction.obligation.title}</h2>
          <p style={{ margin: 0 }}>{nextAction.obligation.reason}</p>
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>{nextAction.propertyLabel}</p>
          {nextAction.obligation.due_on && nextAction.obligation.days_remaining !== null ? (
            <Countdown days={nextAction.obligation.days_remaining} dueOn={nextAction.obligation.due_on} />
          ) : null}
          <div>
            <Link className="btn" href={`/properties/${nextAction.propertyId}`}>Open this property</Link>
          </div>
        </Card>
      ) : (
        <Card className="stack">
          <Status tone="ok">Nothing needs you today</Status>
          <p style={{ margin: 0 }}>Everything we track is in order. We will email you before anything falls due.</p>
        </Card>
      )}

      {drift.length > 0 ? (
        <section className="stack">
          <h2>Your GOV.UK entry is out of date</h2>
          <p style={{ color: "var(--ink-muted)" }}>
            {drift.length === 1 ? "One thing has" : `${drift.length} things have`} changed since
            you last updated the register. You have 28 days from each change.
          </p>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {drift.map((item) => (
              <Card as="li" key={item.id} className="stack">
                <div className="spread">
                  <h3 style={{ margin: 0 }}>{item.field_label}</h3>
                  <Status tone={item.status.state === "overdue" ? "danger" : item.status.state === "due_soon" ? "warn" : "info"}>
                    {item.status.state === "overdue" ? "Overdue" : item.status.state === "due_soon" ? "Due soon" : "Open"}
                  </Status>
                </div>
                <p style={{ margin: 0 }}>
                  {item.property_label}: was <strong>{formatDriftValue(item.field, item.old_value)}</strong>,
                  now <strong>{formatDriftValue(item.field, item.new_value)}</strong>.
                </p>
                <p style={{ margin: 0 }}>{item.status.message}</p>
                <div>
                  <Link className="btn btn-secondary" href={`/properties/${item.property_id}/drift`}>
                    I have updated GOV.UK
                  </Link>
                </div>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}

      {attention.length > 0 ? (
        <section className="stack">
          <h2>Needs attention</h2>
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {attention.map((o) => <ObligationRow key={`${o.property_id}-${o.rule_id}`} obligation={o} />)}
          </ul>
        </section>
      ) : null}

      <section className="stack">
        <h2>Your properties</h2>
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {evaluations.map((e) => {
            // "In order" must mean everything applicable is satisfied. Showing it
            // while four obligations are outstanding-but-not-yet-urgent is the
            // kind of reassurance this product must never give.
            const outstanding = e.obligations.filter(
              (o) => o.state !== "satisfied" && o.state !== "not_yet_applicable",
            );
            const worst = e.obligations.find((o) => o.state === "overdue")
              ?? e.obligations.find((o) => o.state === "due_soon");
            const tone = worst
              ? toneForState(worst.state)
              : outstanding.length > 0
                ? { tone: "info" as const, label: `${outstanding.length} to do` }
                : { tone: "ok" as const, label: "All in order" };
            return (
              <Card as="li" key={e.property.id} className="stack">
                <div className="spread">
                  <h3 style={{ margin: 0 }}>
                    <Link href={`/properties/${e.property.id}`}>{propertyLabel(e.property)}</Link>
                  </h3>
                  <Status tone={tone.tone}>{tone.label}</Status>
                </div>
                <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                  {e.obligations.filter((o) => o.state === "satisfied").length} of{" "}
                  {e.obligations.filter((o) => o.state !== "not_yet_applicable").length} in order
                </p>
              </Card>
            );
          })}
        </ul>
      </section>

      {!account.calm_mode && exposure > 0n ? (
        <Card className="stack card-quiet">
          <h2 style={{ margin: 0 }}>Exposure</h2>
          <p style={{ margin: 0, fontSize: "var(--text-xl)" }}><Money pennies={exposure} /></p>
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>
            This is the maximum civil penalty across the {allObligations.filter((o) => o.state === "overdue").length}{" "}
            things currently overdue, added up. It is a ceiling, not a prediction —
            councils decide penalties case by case and must be satisfied to the
            criminal standard. You can turn this off in your settings.
          </p>
        </Card>
      ) : null}

      <p style={{ color: "var(--ink-muted)" }}>Showing your position as at {formatUkLong(now)}.</p>
      <LegalFooter />
    </div>
  );
}

function pickNextAction(
  evaluations: { property: { id: string; line1: string; town: string | null; postcode: string }; next_action: Obligation | null }[],
): { obligation: Obligation; propertyId: string; propertyLabel: string } | null {
  const candidates = evaluations
    .filter((e) => e.next_action !== null)
    .map((e) => ({
      obligation: e.next_action!,
      propertyId: e.property.id,
      propertyLabel: propertyLabel(e.property),
    }));

  if (candidates.length === 0) return null;

  // Overdue first, then the soonest due date.
  return candidates.sort((a, b) => {
    const rank = (o: Obligation) => (o.state === "overdue" ? 0 : o.state === "due_soon" ? 1 : 2);
    const byRank = rank(a.obligation) - rank(b.obligation);
    if (byRank !== 0) return byRank;
    return (a.obligation.due_on ?? "9999").localeCompare(b.obligation.due_on ?? "9999");
  })[0]!;
}
