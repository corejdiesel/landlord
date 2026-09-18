import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUkLong } from "@letsorted/rules";
import { Card, Status } from "../../../../../components/ui";
import { requireSession } from "../../../../../lib/auth";
import { buildDefenceFile } from "../../../../../lib/defence-file";
import { getProperty, propertyLabel } from "../../../../../lib/repository";
import { today } from "../../../../../lib/env";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Your record", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The Defence File, rendered for screen and for print.
 *
 * Print-first in spirit: the thing a landlord actually needs is something they
 * can put in front of a council officer, so the print stylesheet is not an
 * afterthought here.
 */
export default async function DefenceFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  const property = await getProperty(session, id);
  if (!property) notFound();

  const file = await buildDefenceFile(session, today(), id);

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <div className="no-print stack">
        <p style={{ margin: 0 }}><Link href={`/properties/${id}`}>← {propertyLabel(property)}</Link></p>
        <div className="spread">
          <h1 style={{ margin: 0 }}>Your record</h1>
          <PrintButton />
        </div>
        <p style={{ maxWidth: "var(--measure)" }}>
          A clear record of what you did and when, in order, with a fingerprint for
          every document. You can print it or hand it over as it stands.
        </p>
      </div>

      <header className="print-only">
        <h1>Compliance record</h1>
        <p>{file.account_name} — {file.property_label}</p>
        <p>Produced on {formatUkLong(file.generated_on)}</p>
      </header>

      <Card className="stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Integrity</h2>
          <Status tone={file.chain_intact ? "ok" : "danger"}>
            {file.chain_intact ? "Record intact" : "Record altered"}
          </Status>
        </div>
        {file.chain_intact ? (
          <p style={{ margin: 0 }}>
            Every entry below carries a fingerprint of its own contents and of the
            entry before it. We have checked the whole chain and it is unbroken, so
            nothing has been changed or removed since it was written.
          </p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              The chain does not verify. That means an entry has been altered or
              removed since it was written. Details:
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
              {file.problems.map((p) => <li key={p.seq}>Entry {p.seq}: {p.problem}</li>)}
            </ul>
          </>
        )}
        {file.last_hash ? (
          <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-muted)", wordBreak: "break-all" }}>
            Latest fingerprint: {file.last_hash}
          </p>
        ) : null}
      </Card>

      <section className="stack">
        <h2>What happened, in order</h2>
        {file.events.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Nothing recorded for this property yet.</p></Card>
        ) : (
          <table>
            <caption className="visually-hidden">Chronological compliance record</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">When</th>
                <th scope="col">What happened</th>
                <th scope="col">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {file.events.map((e) => (
                <tr key={e.seq}>
                  <td className="num">{e.seq}</td>
                  <td className="num">
                    <time dateTime={e.at}>{formatUkLong(e.at.slice(0, 10))}</time>
                  </td>
                  <td>{e.description}</td>
                  <td className="num" style={{ fontSize: "var(--text-sm)", wordBreak: "break-all" }}>
                    {e.hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="stack" style={{ breakBefore: "page" }}>
        <h2>How to check this record</h2>
        <Card className="stack">
          <p style={{ margin: 0 }}>
            Each entry stores the SHA-256 of its own contents, and the fingerprint of
            the entry before it. Changing anything in an earlier entry changes its
            fingerprint, which breaks the link to every entry after it.
          </p>
          <ol style={{ margin: 0, paddingLeft: "1.2em" }}>
            <li style={{ marginBottom: "var(--space-2)" }}>
              Take an entry&rsquo;s contents and compute its SHA-256. It must match the
              fingerprint stored against it.
            </li>
            <li style={{ marginBottom: "var(--space-2)" }}>
              Combine the account reference, the entry number, its type, that content
              fingerprint and the previous entry&rsquo;s fingerprint, and compute the
              SHA-256 of the result. It must match the entry&rsquo;s own fingerprint.
            </li>
            <li>
              Repeat down the chain. The first entry&rsquo;s previous fingerprint is
              derived from the account reference, so a chain cannot be moved between
              accounts.
            </li>
          </ol>
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>
            This shows the record has not been edited since it was written. It does not,
            by itself, prove anything about the underlying facts.
          </p>
        </Card>
      </section>

      <p className="footer-note">
        General information, not legal advice. This is a record of what was done and
        when — it is not a defence in itself, and a council decides penalties case by
        case on the evidence before it.
      </p>
    </div>
  );
}
