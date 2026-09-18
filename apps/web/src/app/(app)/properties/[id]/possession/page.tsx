import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ALL_RULES, evaluate, possessionReadiness, radarFor, ruleById,
  type PossessionCheck,
} from "@letsorted/rules";
import { Card, LegalFooter, Provenance, Status } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/auth";
import { withAccount } from "../../../../../lib/db";
import { evaluationInputFor, getProperty, propertyLabel } from "../../../../../lib/repository";
import { today } from "../../../../../lib/env";

export const metadata: Metadata = { title: "Possession readiness" };
export const dynamic = "force-dynamic";

export default async function PossessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const now = today();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const radar = radarFor(property.itl1_region, now);

  const result = await withAccount(session, async (client) => {
    const input = await evaluationInputFor(client, id, now);
    if (!input) return null;
    return possessionReadiness(input, evaluate(input, ALL_RULES, {}), {
      registrationDeadlinePassed: radar.state === "deadline_passed",
    });
  });

  if (!result) notFound();

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <p style={{ margin: 0 }}><Link href={`/properties/${id}`}>← {propertyLabel(property)}</Link></p>

      <div className="stack">
        <h1 style={{ margin: 0 }}>Is anything on your side out of order?</h1>
        <p style={{ maxWidth: "var(--measure)" }}>
          If you needed to seek possession, these are the things on your side of the
          file that a court or a tenant&rsquo;s adviser would look at.
        </p>
      </div>

      <Card className="stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Overall</h2>
          <Status tone={result.overall === "green" ? "ok" : result.overall === "amber" ? "warn" : "danger"}>
            {result.overall === "green" ? "Nothing outstanding"
              : result.overall === "amber" ? "Something to tidy up"
              : "Something would block or weaken it"}
          </Status>
        </div>
        <p style={{ margin: 0, fontWeight: 600 }}>{result.caveat}</p>
      </Card>

      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {result.checks.map((c) => <CheckRow key={c.id} check={c} />)}
      </ul>

      <LegalFooter />
    </div>
  );
}

function CheckRow({ check }: { check: PossessionCheck }) {
  const rules = check.rule_ids.map((id) => ruleById(id)).filter((r) => r !== undefined);
  const sources = rules.flatMap((r) => r.sources);

  return (
    <Card as="li" className="stack">
      <div className="spread">
        <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>{check.label}</h3>
        <Status tone={
          check.state === "green" ? "ok"
          : check.state === "amber" ? "warn"
          : check.state === "red" ? "danger"
          : "info"
        }>
          {check.state === "green" ? "In order"
            : check.state === "amber" ? "Worth tidying"
            : check.state === "red" ? "Outstanding"
            : "Does not apply"}
        </Status>
      </div>
      <p style={{ margin: 0 }}>{check.detail}</p>
      {sources.length > 0 && rules[0] ? (
        <Provenance
          sources={sources}
          verification={rules[0].verification_status}
          status={rules[0].status}
        />
      ) : null}
    </Card>
  );
}
