import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REGION_LABELS, formatUkLong, radarFor } from "@letsorted/rules";
import { Card, Countdown, LegalFooter, Money, ObligationRow, Stamp, Status } from "../../../../components/ui";
import { requireSession } from "../../../../lib/auth";
import { withAccount } from "../../../../lib/db";
import { evaluationInputFor, getProperty, propertyLabel } from "../../../../lib/repository";
import { evaluate, ALL_RULES, exposurePennies } from "@letsorted/rules";
import { today } from "../../../../lib/env";
import { TenancyForm } from "./tenancy-form";
import { RecordRegistrationForm } from "./record-registration-form";

export const metadata: Metadata = { title: "Property" };
export const dynamic = "force-dynamic";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const now = today();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const { obligations, tenancy, registration } = await withAccount(session, async (client) => {
    const input = await evaluationInputFor(client, id, now);
    if (!input) return { obligations: [], tenancy: null, registration: null };
    return {
      obligations: evaluate(input, ALL_RULES, {}),
      tenancy: input.tenancy,
      registration: input.registration,
    };
  });

  const radar = radarFor(property.itl1_region, now);
  const isRegistered = registration?.status === "active";

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <div className="stack">
        <h1 style={{ margin: 0 }}>{propertyLabel(property)}</h1>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          {REGION_LABELS[property.itl1_region]} · {property.bedrooms} bedroom
          {property.bedrooms === 1 ? "" : "s"} · {property.ownership.replace(/_/g, " ")}
        </p>
      </div>

      <Card className="stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Registration</h2>
          {isRegistered ? (
            <Stamp label="Registered" date={registration.registered_on ?? now} />
          ) : (
            <Status tone={radar.state === "deadline_passed" ? "danger" : radar.state === "open_now" ? "warn" : "info"}>
              {radar.state === "deadline_passed" ? "Deadline passed" : radar.state === "open_now" ? "Open now" : "Not open yet"}
            </Status>
          )}
        </div>

        {isRegistered ? (
          <>
            <table>
              <caption className="visually-hidden">Registration details</caption>
              <tbody>
                <tr><th scope="row">Property registration number</th><td className="num">{registration.property_registration_number}</td></tr>
                <tr><th scope="row">Registered on</th><td className="num">{registration.registered_on ? formatUkLong(registration.registered_on) : "—"}</td></tr>
                <tr><th scope="row">Renews on</th><td className="num">{registration.renewal_due_on ? formatUkLong(registration.renewal_due_on) : "—"}</td></tr>
              </tbody>
            </table>
            <p style={{ margin: 0, color: "var(--ink-muted)" }}>
              Renewal is manual. The government will not take it automatically, because
              you have to confirm the details are still right.
            </p>
          </>
        ) : (
          <>
            <Countdown
              days={radar.state === "not_open_yet" ? radar.days_until_open : radar.days_until_deadline}
              dueOn={radar.state === "not_open_yet" ? radar.commences_on : radar.deadline_on}
              verb={radar.state === "not_open_yet" ? "until you can register" : "to register"}
            />
            <p style={{ margin: 0 }}>{radar.headline}</p>
            <div className="row">
              <Link className="btn" href={`/properties/${id}/rehearsal`}>Get your answers ready</Link>
            </div>
            <RecordRegistrationForm propertyId={id} />
          </>
        )}
      </Card>

      <section className="stack">
        <h2>The letting</h2>
        <TenancyForm propertyId={id} tenancy={tenancy ? {
          kind: tenancy.kind,
          started_on: tenancy.started_on,
          rent_pounds: Number(tenancy.rent_pennies) / 100,
          rent_frequency: tenancy.rent_frequency,
          bills_included: tenancy.bills_included,
          households: tenancy.households,
          occupants: tenancy.occupants,
        } : null} isRegistered={isRegistered} />
      </section>

      <section className="stack">
        <h2>Also on this property</h2>
        <div className="row">
          <Link className="btn btn-secondary" href={`/properties/${id}/possession`}>
            Possession readiness
          </Link>
          <Link className="btn btn-secondary" href={`/properties/${id}/defence-file`}>
            Your record
          </Link>
          <Link className="btn btn-secondary" href={`/properties/${id}/drift`}>
            Update GOV.UK entry
          </Link>
          <Link className="btn btn-secondary" href={`/properties/${id}/sharing`}>
            Sharing
          </Link>
        </div>
      </section>

      <section className="stack">
        <h2>What is due</h2>
        {obligations.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Nothing to track yet. Add the letting details above.</p></Card>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {obligations.map((o) => <ObligationRow key={o.rule_id} obligation={o} />)}
          </ul>
        )}
      </section>

      {exposurePennies(obligations) > 0n ? (
        <Card className="stack card-quiet">
          <p style={{ margin: 0 }}>
            Maximum civil penalty exposure for this property, across what is
            currently overdue: <Money pennies={exposurePennies(obligations)} />. A
            ceiling, not a prediction.
          </p>
        </Card>
      ) : null}

      <LegalFooter />
    </div>
  );
}
