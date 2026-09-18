import type { Metadata } from "next";
import Link from "next/link";
import { REGION_LABELS, formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Status, toneForState } from "../../../components/ui";
import { requireSession } from "../../../lib/auth";
import { evaluateAccount, propertyLabel } from "../../../lib/repository";
import { today } from "../../../lib/env";

export const metadata: Metadata = { title: "Properties" };
export const dynamic = "force-dynamic";

export default async function PropertiesPage() {
  const session = await requireSession();
  const now = today();
  const evaluations = await evaluateAccount(session, now);

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Properties</h1>
        <Link className="btn" href="/properties/new">Add a property</Link>
      </div>

      {evaluations.length === 0 ? (
        <Card className="stack">
          <p style={{ margin: 0 }}>You have not added a property yet.</p>
        </Card>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {evaluations.map((e) => {
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
            const registration = e.obligations.find((o) => o.rule_id === "PRS-REG-DWELLING");
            return (
              <Card as="li" key={e.property.id} className="stack">
                <div className="spread">
                  <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>
                    <Link href={`/properties/${e.property.id}`}>{propertyLabel(e.property)}</Link>
                  </h2>
                  <Status tone={tone.tone}>{tone.label}</Status>
                </div>
                <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                  {REGION_LABELS[e.property.itl1_region]}
                  {registration?.due_on ? (
                    <> — register by <time dateTime={registration.due_on}>{formatUkLong(registration.due_on)}</time></>
                  ) : null}
                </p>
              </Card>
            );
          })}
        </ul>
      )}

      <LegalFooter />
    </div>
  );
}
