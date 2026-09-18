import Link from "next/link";
import { formatUkLong } from "@letsorted/rules";
import { LegalFooter } from "../components/ui";
import { today } from "../lib/env";
import { RadarForm } from "./radar-form";

/**
 * The public front page.
 *
 * This is the acquisition engine, so it earns its keep by answering the one
 * question a landlord actually has — "when does this hit me?" — above the fold,
 * with no signup. Everything else is secondary.
 */
export default function HomePage() {
  return (
    <>
      <header className="wrap" style={{ paddingTop: "var(--space-7)", paddingBottom: "var(--space-5)" }}>
        <div className="spread">
          <strong style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-lg)" }}>Let Sorted</strong>
          <nav aria-label="Main">
            <Link href="/design" style={{ marginRight: "var(--space-4)" }}>Style guide</Link>
            <Link href="/sign-in">Sign in</Link>
          </nav>
        </div>
      </header>

      <div className="wrap stack-lg" style={{ paddingBottom: "var(--space-9)" }}>
        <section className="stack">
          <h1 style={{ fontSize: "var(--text-3xl)", maxWidth: "20ch" }}>
            Find out when you have to register your rental property.
          </h1>
          <p style={{ fontSize: "var(--text-lg)", maxWidth: "50ch" }}>
            Landlords in England must register each let property on the new government
            database. When that starts depends on where the property is — not where
            you live. Put in a postcode and we will tell you your dates.
          </p>
        </section>

        <RadarForm />

        <section className="stack">
          <h2>What this is</h2>
          <p>
            Registering takes about ten minutes on GOV.UK, and we never touch that
            form — you submit it yourself. What we do is everything around it:
            knowing your deadline, having your answers ready, keeping the entry
            true as things change, renewing on time, and being able to show what
            you did and when.
          </p>
          <p style={{ color: "var(--ink-muted)" }}>
            Today is {formatUkLong(today())}.
          </p>
        </section>

        <LegalFooter />
      </div>
    </>
  );
}
