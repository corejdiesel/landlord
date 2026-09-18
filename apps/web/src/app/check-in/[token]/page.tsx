import type { Metadata } from "next";
import { Card, Status } from "../../../components/ui";
import { lookupPulse } from "../../../lib/pulse";
import { CheckInForm } from "./form";

export const metadata: Metadata = {
  title: "A quick question about your home",
  // Never indexed: this is a private link to a tenant.
  robots: { index: false, follow: false, nocache: true },
};
export const dynamic = "force-dynamic";

/**
 * The tenant check-in.
 *
 * No login, two questions, and an explanation of why we are asking before we
 * ask. The page deliberately does not show the address: a link that leaks
 * should not tell the finder where someone lives.
 */
export default async function CheckInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await lookupPulse(token);

  return (
    <div className="wrap-narrow stack-lg" style={{ paddingTop: "var(--space-8)", paddingBottom: "var(--space-9)" }}>
      <h1>A quick question about your home</h1>

      {!result.ok ? (
        <Card className="stack">
          <Status tone={result.reason === "answered" ? "ok" : "warn"}>
            {result.reason === "answered" ? "Already answered" : "Link not valid"}
          </Status>
          <p style={{ margin: 0 }}>
            {result.reason === "answered"
              ? "Thank you — this has already been answered. There is nothing else to do."
              : "This link has expired or is not valid. Ask your landlord to send a new one."}
          </p>
        </Card>
      ) : (
        <>
          <Card className="stack">
            <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Why we are asking</h2>
            <p style={{ margin: 0 }}>
              Landlords in England have to tell the government how many people live in
              a rented home, and keep it up to date. Your landlord is asking you
              because they do not want to guess.
            </p>
            <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>What we do not ask for</h2>
            <p style={{ margin: 0 }}>
              We do not ask for your name, your date of birth, your phone number or
              anything about you as a person. We store two numbers and the date you
              answered. That is all.
            </p>
          </Card>

          <CheckInForm token={token} />

          <p className="footer-note">
            Answering is voluntary. If you would rather not, tell your landlord and
            they can record it another way.
          </p>
        </>
      )}
    </div>
  );
}
