import type { Metadata } from "next";
import { ALL_RULES, formatUkLong } from "@letsorted/rules";
import { Card, Countdown, LegalFooter, Money, Provenance, Stamp, Status } from "../../components/ui";

export const metadata: Metadata = {
  title: "Style guide",
  robots: { index: false, follow: false },
};

/**
 * Living style guide.
 *
 * Built before the feature screens on purpose: it is much cheaper to settle the
 * type scale, the status language and the print rules here than to discover
 * them inconsistently across twenty pages.
 */
export default function DesignPage() {
  const sampleRule = ALL_RULES.find((r) => r.id === "PRS-REG-DWELLING")!;
  const unverifiedRule = ALL_RULES.find((r) => r.verification_status === "unverified")!;

  return (
    <div className="wrap stack-lg" style={{ paddingTop: "var(--space-7)", paddingBottom: "var(--space-9)" }}>
      <header className="stack">
        <h1>Style guide</h1>
        <p style={{ fontSize: "var(--text-lg)" }}>
          Civic calm: the trust of a well-made public service with the warmth of a
          good stationery brand. A typeset ledger, not a dashboard.
        </p>
      </header>

      <Section title="Type scale" note="18px base. Nothing below 16px anywhere in the product.">
        <div className="stack">
          <p style={{ fontSize: "var(--text-3xl)", fontFamily: "var(--font-serif)", margin: 0 }}>Display 48px</p>
          <p style={{ fontSize: "var(--text-2xl)", fontFamily: "var(--font-serif)", margin: 0 }}>Heading 1, 36px</p>
          <p style={{ fontSize: "var(--text-xl)", fontFamily: "var(--font-serif)", margin: 0 }}>Heading 2, 28px</p>
          <p style={{ fontSize: "var(--text-lg)", margin: 0 }}>Large body, 22px</p>
          <p style={{ margin: 0 }}>Body, 18px — the default. Long enough to read comfortably at arm&rsquo;s length.</p>
          <p style={{ fontSize: "var(--text-sm)", margin: 0 }}>Small, 16px — the floor.</p>
        </div>
      </Section>

      <Section title="Colour" note="Paper and ink. One deep accent. Dark theme is first class.">
        <div className="row" style={{ alignItems: "stretch" }}>
          {[
            ["Paper", "var(--paper)"], ["Raised", "var(--paper-raised)"], ["Sunken", "var(--paper-sunken)"],
            ["Ink", "var(--ink)"], ["Muted", "var(--ink-muted)"], ["Rule", "var(--rule)"],
            ["Accent", "var(--accent)"],
          ].map(([name, value]) => (
            <div key={name} style={{ minWidth: "7rem" }}>
              <div style={{ background: value, border: "1px solid var(--rule-strong)", height: "3.5rem", borderRadius: "var(--radius)" }} />
              <p style={{ fontSize: "var(--text-sm)", margin: "var(--space-2) 0 0" }}>{name}</p>
            </div>
          ))}
        </div>
        <p style={{ marginTop: "var(--space-4)" }}>
          The accent defaults to bottle green. Oxblood is the alternative — set{" "}
          <code>data-accent=&quot;oxblood&quot;</code> on <code>&lt;html&gt;</code>. Both are in{" "}
          <code>tokens.css</code>; the choice is Joe&rsquo;s, and it is noted in{" "}
          <code>QUESTIONS_FOR_JOE.md</code>.
        </p>
      </Section>

      <Section
        title="Status"
        note="Colour is never the only carrier. Every status has a glyph and a word as well, so it survives colour blindness, greyscale printing and a bad screen."
      >
        <div className="row">
          <Status tone="ok">In order</Status>
          <Status tone="warn">Due soon</Status>
          <Status tone="danger">Overdue</Status>
          <Status tone="info">Not yet</Status>
        </div>
      </Section>

      <Section title="Countdown" note="The hero element. Serif, large, tabular figures. The accessible name spells the whole thing out.">
        <div className="stack">
          <Countdown days={88} dueOn="2026-12-15" verb="until you can register" />
          <Countdown days={13} dueOn="2027-03-14" verb="to register" />
          <Countdown days={-4} dueOn="2027-03-14" />
          <p className="hint" style={{ margin: 0 }}>
            A screen reader announces the third as &ldquo;4 days overdue, was due 14 March 2027&rdquo;,
            not &ldquo;minus four&rdquo;.
          </p>
        </div>
      </Section>

      <Section title="The stamp" note="One moment of delight, used sparingly. Completed obligations only — a stamp on everything is wallpaper, not a motif.">
        <div className="row">
          <Stamp label="Registered" date="2027-02-04" />
          <Stamp label="Confirmed" date={formatUkLong("2026-09-18") ? "2026-09-18" : "2026-09-18"} />
        </div>
      </Section>

      <Section title="Buttons and inputs" note="44px minimum target. No icon-only controls.">
        <div className="stack">
          <div className="row">
            <button className="btn" type="button">Primary action</button>
            <button className="btn btn-secondary" type="button">Secondary</button>
            <button className="btn btn-quiet" type="button">Quiet</button>
            <button className="btn" type="button" disabled>Disabled</button>
          </div>
          <div style={{ maxWidth: "24rem" }}>
            <label htmlFor="demo-input">A labelled field</label>
            <p className="hint" id="demo-hint">Hints sit above the field, not in a tooltip.</p>
            <input id="demo-input" type="text" aria-describedby="demo-hint" placeholder="B1 1AA" />
          </div>
        </div>
      </Section>

      <Section title="Money" note="Pennies as bigint, one formatter, tabular figures.">
        <div className="stack">
          <p style={{ margin: 0, fontSize: "var(--text-xl)" }}><Money pennies={6500n} /> per property per year</p>
          <p style={{ margin: 0 }}><Money pennies={97500n} /> for a portfolio of 15</p>
          <p style={{ margin: 0 }}><Money pennies={4000000n} /> maximum penalty for false information</p>
        </div>
      </Section>

      <Section title="Provenance" note="Product principle 2: every claim has a source and a date, and you can see both. A disclosure, not a tooltip — tooltips are hover-only.">
        <div className="stack">
          <Card className="stack">
            <h3 style={{ margin: 0 }}>{sampleRule.title}</h3>
            <p style={{ margin: 0 }}>{sampleRule.summary}</p>
            <Provenance sources={sampleRule.sources} verification={sampleRule.verification_status} status={sampleRule.status} />
          </Card>
          <Card className="stack">
            <div className="spread">
              <h3 style={{ margin: 0 }}>{unverifiedRule.title}</h3>
              <Status tone="info">Not verified</Status>
            </div>
            <p style={{ margin: 0 }}>{unverifiedRule.summary}</p>
            <Provenance sources={unverifiedRule.sources} verification={unverifiedRule.verification_status} status={unverifiedRule.status} />
            <p className="hint" style={{ margin: 0 }}>
              Unverified rules are feature-flagged away from end users. This card exists
              so the state is designed rather than discovered.
            </p>
          </Card>
        </div>
      </Section>

      <Section title="Tables" note="Uppercase small headers, hairline rules, tabular figures. Like a ledger.">
        <table>
          <caption className="visually-hidden">Example regional timetable</caption>
          <thead>
            <tr><th scope="col">Region</th><th scope="col">Opens</th><th scope="col">Deadline</th></tr>
          </thead>
          <tbody>
            <tr><td>West Midlands</td><td className="num">15 December 2026</td><td className="num">14 March 2027</td></tr>
            <tr><td>London</td><td className="num">15 July 2027</td><td className="num">14 October 2027</td></tr>
          </tbody>
        </table>
      </Section>

      <Section title="Print" note="A paper route exists for the government service, so our packs must print properly. Print this page to see it.">
        <p style={{ margin: 0 }}>
          A4 with 18mm margins, navigation and buttons removed, cards kept whole across
          page breaks, table headers repeated, and link destinations printed after the
          link text so a paper copy is still usable.
        </p>
      </Section>

      <LegalFooter />
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--space-5)" }}>
      <h2 style={{ marginBottom: 0 }}>{title}</h2>
      {note ? <p style={{ color: "var(--ink-muted)", maxWidth: "var(--measure)" }}>{note}</p> : null}
      {children}
    </section>
  );
}
