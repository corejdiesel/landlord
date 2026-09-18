import type { Metadata } from "next";
import { formatUkLong } from "@letsorted/rules";
import { Card, LegalFooter, Stamp, Status } from "../../../components/ui";
import { requireSession } from "../../../lib/auth";
import { withAccount } from "../../../lib/db";
import { listProperties, propertyLabel } from "../../../lib/repository";
import { env } from "../../../lib/env";
import { UploadForm, InboundSimulator } from "./upload-form";
import { ConfirmExtraction } from "./confirm-form";
import { humanKind } from "./labels";

export const metadata: Metadata = { title: "Documents" };
export const dynamic = "force-dynamic";

type DocRow = {
  id: string;
  property_id: string | null;
  kind: string;
  original_filename: string | null;
  issued_on: string | null;
  expires_on: string | null;
  outcome: string;
  epc_rating: string | null;
  confidence: Record<string, number> | null;
  confirmed_on: string | null;
  sha256: string | null;
};

export default async function DocumentsPage() {
  const session = await requireSession();
  const properties = await listProperties(session);

  const documents = await withAccount(session, async (client) => {
    const { rows } = await client.query<DocRow>(
      `select id, property_id, kind::text as kind, original_filename,
              to_char(issued_on, 'YYYY-MM-DD') as issued_on,
              to_char(expires_on, 'YYYY-MM-DD') as expires_on,
              outcome::text as outcome, epc_rating, confidence, sha256,
              -- timestamptz comes back from pg as a Date; the rest of the app
              -- works in ISO calendar-date strings, so convert at the boundary.
              to_char(confirmed_at, 'YYYY-MM-DD') as confirmed_on
         from live_documents
        order by created_at desc
        limit 100`,
    );
    return rows;
  });

  const pending = documents.filter((d) => d.confirmed_on === null);
  const confirmed = documents.filter((d) => d.confirmed_on !== null);

  const inboundAddress = `certs+<your token>@${env().INBOUND_EMAIL_DOMAIN}`;

  return (
    <div className="stack-lg" style={{ paddingTop: "var(--space-6)" }}>
      <h1>Documents</h1>
      <p style={{ maxWidth: "var(--measure)" }}>
        Upload a certificate, photograph it, or forward it by email. We read it and
        show you what we found next to the document — nothing counts towards your
        compliance until you confirm it.
      </p>

      <UploadForm properties={properties.map((p) => ({ id: p.id, label: propertyLabel(p) }))} />

      {pending.length > 0 ? (
        <section className="stack">
          <h2>Waiting for you to confirm</h2>
          <p style={{ color: "var(--ink-muted)" }}>
            Check these against the document. Anything we were unsure about is marked.
          </p>
          {pending.map((doc) => (
            <ConfirmExtraction
              key={doc.id}
              document={{
                id: doc.id,
                propertyId: doc.property_id,
                kind: doc.kind,
                filename: doc.original_filename,
                issuedOn: doc.issued_on,
                expiresOn: doc.expires_on,
                outcome: doc.outcome,
                epcRating: doc.epc_rating,
                confidence: doc.confidence ?? {},
              }}
              properties={properties.map((p) => ({ id: p.id, label: propertyLabel(p) }))}
            />
          ))}
        </section>
      ) : null}

      <section className="stack">
        <h2>On file</h2>
        {confirmed.length === 0 ? (
          <Card><p style={{ margin: 0 }}>Nothing confirmed yet.</p></Card>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {confirmed.map((doc) => {
              const property = properties.find((p) => p.id === doc.property_id);
              const expired = doc.expires_on !== null && doc.expires_on < new Date().toISOString().slice(0, 10);
              return (
                <Card as="li" key={doc.id} className="stack">
                  <div className="spread">
                    <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>{humanKind(doc.kind)}</h3>
                    {doc.outcome === "unsatisfactory" ? (
                      <Status tone="danger">Unsatisfactory</Status>
                    ) : expired ? (
                      <Status tone="warn">Expired</Status>
                    ) : (
                      <Stamp label="Confirmed" date={doc.confirmed_on!} />
                    )}
                  </div>
                  <p style={{ margin: 0, color: "var(--ink-muted)" }}>
                    {property ? propertyLabel(property) : "Not linked to a property"}
                    {doc.issued_on ? ` · issued ${formatUkLong(doc.issued_on)}` : ""}
                    {doc.expires_on ? ` · valid until ${formatUkLong(doc.expires_on)}` : ""}
                  </p>
                  {doc.sha256 ? (
                    <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--ink-faint)", wordBreak: "break-all" }}>
                      Fingerprint {doc.sha256.slice(0, 16)}…
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      <section className="stack">
        <h2>Forward by email</h2>
        <Card className="stack">
          <p style={{ margin: 0 }}>
            Every account has its own inbox address. Forward a certificate from your
            engineer straight to it and it turns up here to confirm.
          </p>
          <p style={{ margin: 0, fontFamily: "var(--font-serif)", fontSize: "var(--text-lg)" }}>
            {inboundAddress}
          </p>
          <p className="hint" style={{ margin: 0 }}>
            There is no real mail server in this build, so the address is illustrative.
            Use the simulator below to exercise the same ingest path.
          </p>
        </Card>
        <InboundSimulator />
      </section>

      <LegalFooter />
    </div>
  );
}

