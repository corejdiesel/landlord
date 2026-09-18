import type { Metadata } from "next";
import { Card, Status } from "../../../components/ui";
import { lookupAttestation } from "../../../lib/attestation";
import { AttestationForm } from "./form";

export const metadata: Metadata = {
  title: "Is this right?",
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * The landlord's one-tap attestation.
 *
 * No account required, on purpose: the agent has made a change the landlord is
 * legally responsible for, and putting a signup between them and a ten-second
 * question is how that responsibility gets rubber-stamped instead of checked.
 */
export default async function ConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lookup = await lookupAttestation(token);

  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-9)" }}>
      <h1>Is this right?</h1>

      {!lookup.ok ? (
        <Card className="stack">
          <Status tone={lookup.reason === "answered" ? "ok" : "warn"}>
            {lookup.reason === "answered" ? "Already answered"
              : lookup.reason === "expired" ? "Expired" : "Link not valid"}
          </Status>
          <p style={{ margin: 0 }}>
            {lookup.reason === "answered"
              ? "Thank you — you have already answered this."
              : lookup.reason === "expired"
                ? "This request has expired. Ask your agent to send it again."
                : "This link is not valid. Ask your agent to send a new one."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="stack">
            <p style={{ margin: 0, color: "var(--ink-muted)" }}>
              {lookup.agentName} has updated something about your property.
            </p>
            <p style={{ margin: 0, fontSize: "var(--text-lg)" }}>{lookup.change.sentence}</p>
            <table>
              <caption className="visually-hidden">What changed</caption>
              <tbody>
                <tr><th scope="row">Property</th><td>{lookup.change.property_label}</td></tr>
                <tr><th scope="row">What</th><td>{lookup.change.field_label}</td></tr>
                <tr><th scope="row">Was</th><td className="num">{lookup.change.old_value ?? "not set"}</td></tr>
                <tr><th scope="row">Now</th><td className="num">{lookup.change.new_value ?? "not set"}</td></tr>
              </tbody>
            </table>
            <p style={{ margin: 0 }}>
              Your agent can supply this information, but you remain responsible for
              it being right. That is why we are asking you rather than taking their
              word for it.
            </p>
          </Card>

          <AttestationForm token={token} />
        </>
      )}

      <p className="footer-note">
        General information, not legal advice. Your answer is recorded in both your
        record and your agent&rsquo;s.
      </p>
    </div>
  );
}
