import type { Metadata } from "next";
import { formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter } from "../../../components/ui";
import { requireSession } from "../../../lib/auth";
import { listChanges } from "../../../lib/law-watch";

export const metadata: Metadata = { title: "What changed" };
export const dynamic = "force-dynamic";

/** The user-facing "what changed" feed. Only admin-approved notes appear. */
export default async function ChangesPage() {
  await requireSession();
  const changes = await listChanges(false, "approved");

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <h1>What changed</h1>
      <p style={{ maxWidth: "var(--measure)" }}>
        We watch the government guidance and the legislation, and note anything
        that moves. Every note here has been read and written by a person.
      </p>

      {changes.length === 0 ? (
        <Card><p style={{ margin: 0 }}>Nothing to report. We will add to this as things change.</p></Card>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {changes.map((c) => (
            <Card as="li" key={c.id} className="stack">
              <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>{c.source_label}</h2>
              <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                {formatUkLong(c.detected_on)}
              </p>
              <p style={{ margin: 0 }}>{c.model_summary}</p>
              <p style={{ margin: 0 }}>
                <a href={c.source_url} rel="noopener noreferrer" target="_blank">Read the source</a>
              </p>
            </Card>
          ))}
        </ul>
      )}

      <LegalFooter />
    </div>
  );
}
