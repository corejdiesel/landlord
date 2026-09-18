import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Status } from "../../../../components/ui";
import { requireSession } from "../../../../lib/auth";
import { listChanges } from "../../../../lib/law-watch";
import { ReviewPanel, RunButton } from "./panels";

export const metadata: Metadata = { title: "Law Watch", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Admin review queue.
 *
 * Law Watch never edits a rule. It notices that a page changed, drafts a
 * summary, and stops. An admin reads the diff, writes the note in their own
 * words, and publishes — and even then what is published is a "what changed"
 * note, not a change to the rule corpus. Changing a rule is a code change,
 * reviewed like any other.
 */
export default async function LawWatchAdminPage() {
  const session = await requireSession();
  if (!session.isAdmin) redirect("/dashboard");

  const pending = await listChanges(true, "pending");

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Law Watch</h1>
        <RunButton />
      </div>

      <Card className="stack card-quiet">
        <Status tone="info">How this works</Status>
        <p style={{ margin: 0 }}>
          We fetch the watched sources, hash the content, and flag anything that
          changed. The model drafts a summary; it never edits a rule. You read the
          diff, write the note in your own words, and publish. Changing what the
          product says the law is remains a code change.
        </p>
      </Card>

      {pending.length === 0 ? (
        <Card><p style={{ margin: 0 }}>Nothing waiting for review.</p></Card>
      ) : (
        <ul className="stack-lg" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {pending.map((change) => (
            <Card as="li" key={change.id} className="stack">
              <div className="spread">
                <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>{change.source_label}</h2>
                <Status tone="warn">Waiting for review</Status>
              </div>
              <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                Detected {formatUkLong(change.detected_on)} ·{" "}
                <a href={change.source_url} rel="noopener noreferrer" target="_blank">View the source</a>
              </p>

              {change.affected_rule_ids.length > 0 ? (
                <p style={{ margin: 0 }}>
                  The model thinks these rules might be affected:{" "}
                  <strong>{change.affected_rule_ids.join(", ")}</strong>. Treat that as
                  a hint, not a finding.
                </p>
              ) : null}

              <details>
                <summary style={{ cursor: "pointer", minHeight: "var(--tap-min)", display: "flex", alignItems: "center" }}>
                  The model&rsquo;s draft summary
                </summary>
                <p style={{ marginTop: "var(--space-3)" }}>{change.model_summary ?? "No summary produced."}</p>
              </details>

              <details open>
                <summary style={{ cursor: "pointer", minHeight: "var(--tap-min)", display: "flex", alignItems: "center" }}>
                  What actually changed
                </summary>
                <pre style={{
                  marginTop: "var(--space-3)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  background: "var(--paper-sunken)", padding: "var(--space-4)",
                  borderRadius: "var(--radius)", fontSize: "var(--text-sm)", maxHeight: "24rem", overflow: "auto",
                }}>
                  {change.diff}
                </pre>
              </details>

              <ReviewPanel changeId={change.id} draft={change.model_summary ?? ""} />
            </Card>
          ))}
        </ul>
      )}

      <LegalFooter />
    </div>
  );
}
