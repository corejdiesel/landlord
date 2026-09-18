import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatUkLong } from "@letsorted/rules";
import { Card, Status } from "../../../components/ui";
import { buildPassportView } from "../../../lib/passport";
import { today } from "../../../lib/env";

export const metadata: Metadata = {
  title: "Property details",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * The public Tenant Passport.
 *
 * Shows only fields on the allowlist that the landlord switched on. No landlord
 * address, no date of birth, no documents, and the property is identified by
 * street and town rather than by its full address.
 */
export default async function PassportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await buildPassportView(slug, today());
  if (!view) notFound();

  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-9)" }}>
      <div className="stack">
        <h1 style={{ margin: 0 }}>{view.location}</h1>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          What the landlord has in place for this property.
        </p>
      </div>

      <Card className="stack">
        <table>
          <caption className="visually-hidden">Compliance details for this property</caption>
          <tbody>
            {view.fields.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                <td className="num">
                  {f.value === "In date" || f.value === "Yes" || f.value === "Held" ? (
                    <Status tone="ok">{f.value}</Status>
                  ) : f.value === "Not on record" || f.value === "Not yet" ? (
                    <Status tone="info">{f.value}</Status>
                  ) : (
                    f.value
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="stack card-quiet">
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Shown as at {formatUkLong(view.generated_on)}. The landlord chooses what
          appears here, and can withdraw this page at any time. &ldquo;Not on
          record&rdquo; means we do not hold it — not that it does not exist.
        </p>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-faint)" }}>
          Verified with Let Sorted
        </p>
      </Card>

      <p className="footer-note">
        General information, not legal advice. If something here concerns you, your
        council&rsquo;s private housing team can help.
      </p>
    </div>
  );
}
