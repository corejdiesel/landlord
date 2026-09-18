import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { applicableFields, readiness } from "@letsorted/rules";
import { Card, LegalFooter, Status } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/auth";
import { withAccount } from "../../../../../lib/db";
import { getProperty, propertyLabel } from "../../../../../lib/repository";
import { prefillAnswers } from "./prefill";
import { CopyableAnswer, PrintPackButton } from "./copyable";

export const metadata: Metadata = { title: "Registration pack" };
export const dynamic = "force-dynamic";

/**
 * The Registration Rehearsal and Pack.
 *
 * Registration itself takes about ten minutes on GOV.UK and we never touch that
 * form. What this does is make it a copy-and-confirm job: the same questions in
 * the same order, every answer we already hold filled in with a copy button, and
 * a readiness score that names what is missing and what to do about it.
 */
export default async function RehearsalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const { answers, entityType } = await withAccount(session, (client) => prefillAnswers(client, id));
  const score = readiness(answers, entityType);
  const fields = applicableFields(answers, entityType);

  const sections = fields.reduce<Map<string, { title: string; intro?: string; items: typeof fields }>>(
    (acc, entry) => {
      const existing = acc.get(entry.section.id);
      if (existing) existing.items.push(entry);
      else acc.set(entry.section.id, {
        title: entry.section.title,
        ...(entry.section.intro ? { intro: entry.section.intro } : {}),
        items: [entry],
      });
      return acc;
    },
    new Map(),
  );

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <div className="stack no-print">
        <p style={{ margin: 0 }}><Link href={`/properties/${id}`}>← {propertyLabel(property)}</Link></p>
        <h1 style={{ margin: 0 }}>Your registration pack</h1>
        <p style={{ maxWidth: "var(--measure)" }}>
          These are the questions GOV.UK will ask, in the order it asks them, with
          your answers ready to copy. You register on GOV.UK yourself — we never
          touch that form. Come back afterwards and record your numbers.
        </p>
      </div>

      <div className="print-only">
        <h1>Registration pack — {propertyLabel(property)}</h1>
      </div>

      <Card className="stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Readiness</h2>
          <Status tone={score.ready ? "ok" : score.score >= 70 ? "warn" : "danger"}>
            {score.score}% ready
          </Status>
        </div>
        <p style={{ margin: 0 }}>
          {score.answered} of {score.required} required answers are ready.
        </p>
        {score.blockers.length > 0 ? (
          <>
            <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>What is missing</h3>
            <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
              {score.blockers.map((b) => (
                <li key={b.field_id} style={{ marginBottom: "var(--space-2)" }}>{b.message}</li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ margin: 0 }}>
            Everything the form asks for is ready. Open GOV.UK and work down this page.
          </p>
        )}
        <div className="row no-print">
          <a className="btn" href="https://www.gov.uk/" rel="noopener noreferrer" target="_blank">
            Go to GOV.UK to register
          </a>
          <PrintPackButton />
        </div>
      </Card>

      {[...sections.entries()].map(([sectionId, section]) => (
        <section key={sectionId} className="stack">
          <h2>{section.title}</h2>
          {section.intro ? <p style={{ color: "var(--ink-muted)" }}>{section.intro}</p> : null}
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {section.items.map(({ field }) => (
              <CopyableAnswer
                key={field.id}
                question={field.question}
                value={formatAnswer(answers[field.id], field.options)}
                help={field.help ?? null}
                required={field.required}
              />
            ))}
          </ul>
        </section>
      ))}

      <Card className="stack no-print">
        <h2 style={{ margin: 0 }}>Jointly owned?</h2>
        <p style={{ margin: 0 }}>
          The property is registered once, but each of you needs your own landlord
          registration number. Send your co-owner a link and they can do their half
          without needing an account here.
        </p>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Co-owner invites are not built yet — noted in the handover.
        </p>
      </Card>

      <LegalFooter />
    </div>
  );
}

function formatAnswer(
  value: string | number | boolean | null | undefined,
  options?: { value: string; label: string }[],
): string | null {
  if (value === null || value === undefined || value === "") return null;
  const asString = String(value);
  // Show the government's own label, not our enum value.
  return options?.find((o) => o.value === asString)?.label ?? asString;
}
