import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Status } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/auth";
import { withAccount } from "../../../../../lib/db";
import { getProperty, propertyLabel } from "../../../../../lib/repository";
import { env } from "../../../../../lib/env";
import { CheckInPanel, PassportPanel } from "./panels";

export const metadata: Metadata = { title: "Sharing" };
export const dynamic = "force-dynamic";

export default async function SharingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const { passports, responses } = await withAccount(session, async (client) => {
    const { rows: passports } = await client.query<{
      slug: string; created_on: string; revoked_on: string | null;
    }>(
      `select slug, to_char(created_at, 'YYYY-MM-DD') as created_on,
              to_char(revoked_at, 'YYYY-MM-DD') as revoked_on
         from live_passports where property_id = $1 order by created_at desc`,
      [id],
    );
    const { rows: responses } = await client.query<{
      households: number; occupants: number; answered_on: string;
    }>(
      `select r.households, r.occupants, to_char(r.answered_at, 'YYYY-MM-DD') as answered_on
         from live_pulse_responses r
         join live_pulse_requests q on q.id = r.pulse_request_id
        where q.property_id = $1 order by r.answered_at desc limit 10`,
      [id],
    );
    return { passports, responses };
  });

  const live = passports.filter((p) => p.revoked_on === null);

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <p style={{ margin: 0 }}><Link href={`/properties/${id}`}>← {propertyLabel(property)}</Link></p>
      <h1 style={{ margin: 0 }}>Sharing</h1>

      <section className="stack">
        <h2>Ask your tenant how many people live there</h2>
        <p style={{ maxWidth: "var(--measure)" }}>
          The register wants the number of households and occupants kept current, and
          you have no natural way to know. This sends a link that asks two questions
          and collects nothing else — no name, no contact details.
        </p>
        <CheckInPanel propertyId={id} />

        {responses.length > 0 ? (
          <Card className="stack">
            <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>Answers so far</h3>
            <table>
              <caption className="visually-hidden">Occupancy check-in answers</caption>
              <thead>
                <tr><th scope="col">Answered</th><th scope="col">Households</th><th scope="col">People</th></tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.answered_on + r.occupants}>
                    <td className="num">{formatUkLong(r.answered_on)}</td>
                    <td className="num">{r.households}</td>
                    <td className="num">{r.occupants}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </section>

      <section className="stack">
        <h2>A page tenants can look at</h2>
        <p style={{ maxWidth: "var(--measure)" }}>
          A shareable page showing what you have in place. It never shows your
          address, your date of birth or any document. You choose what appears, and
          you can withdraw it at any time.
        </p>

        {live.length > 0 ? (
          <Card className="stack">
            <Status tone="ok">Live</Status>
            {live.map((p) => (
              <div key={p.slug} className="stack">
                <p style={{ margin: 0, wordBreak: "break-all" }}>
                  <a href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer">
                    {env().APP_URL}/p/{p.slug}
                  </a>
                </p>
                <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                  Published {formatUkLong(p.created_on)}
                </p>
                <PassportPanel propertyId={id} mode="revoke" slug={p.slug} />
              </div>
            ))}
          </Card>
        ) : (
          <PassportPanel propertyId={id} mode="create" />
        )}
      </section>

      <LegalFooter />
    </div>
  );
}
