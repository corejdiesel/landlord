import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDriftValue, formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Status } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/auth";
import { listOpenDrift } from "../../../../../lib/drift-service";
import { getProperty, propertyLabel } from "../../../../../lib/repository";
import { today } from "../../../../../lib/env";
import { ConfirmDriftForm } from "./confirm-form";

export const metadata: Metadata = { title: "Update your GOV.UK entry" };
export const dynamic = "force-dynamic";

export default async function DriftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const items = (await listOpenDrift(session, today())).filter((i) => i.property_id === id);

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <p style={{ margin: 0 }}><Link href={`/properties/${id}`}>← {propertyLabel(property)}</Link></p>
      <h1 style={{ margin: 0 }}>Update your GOV.UK entry</h1>

      {items.length === 0 ? (
        /**
         * Also the state you land in immediately after confirming: a server
         * action re-renders this route, which would otherwise wipe the success
         * message out from under the person who just acted. So the empty state
         * has to acknowledge the work, not just report emptiness.
         */
        <Card className="stack">
          <Status tone="ok">Nothing to update</Status>
          <p style={{ margin: 0 }}>
            Your GOV.UK entry matches what you have told us. Anything you have just
            confirmed is recorded, and we will tell you the moment something changes.
          </p>
          <div>
            <Link className="btn btn-secondary" href={`/properties/${id}/defence-file`}>
              See your record
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <p style={{ maxWidth: "var(--measure)" }}>
            These things have changed since you last updated the register. Sign in to
            GOV.UK, change them there, then tick them off here. We never touch that
            form — you make the change and tell us you have.
          </p>

          <Card className="stack">
            <h2 style={{ margin: 0 }}>What to change on GOV.UK</h2>
            <table>
              <caption className="visually-hidden">Fields that have changed since registration</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Your entry says</th>
                  <th scope="col">Should now say</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.field_label}</td>
                    <td className="num">{formatDriftValue(item.field, item.old_value)}</td>
                    <td className="num"><strong>{formatDriftValue(item.field, item.new_value)}</strong></td>
                    <td className="num">
                      <time dateTime={item.due_on}>{formatUkLong(item.due_on)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ConfirmDriftForm
            items={items.map((i) => ({
              id: i.id,
              label: i.field_label,
              newValue: formatDriftValue(i.field, i.new_value),
              dueOn: i.due_on,
              state: i.status.state,
            }))}
          />
        </>
      )}

      <LegalFooter />
    </div>
  );
}
