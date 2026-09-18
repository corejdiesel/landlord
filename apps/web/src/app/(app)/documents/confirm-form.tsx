"use client";

import { useActionState, useState } from "react";
import { Card, Status } from "../../../components/ui";
import { confirmExtraction } from "./actions";

export type PendingDocument = {
  id: string;
  propertyId: string | null;
  kind: string;
  filename: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  outcome: string;
  epcRating: string | null;
  confidence: Record<string, number>;
};

/** Below this, a field is called out for the human to look at properly. */
const LOW_CONFIDENCE = 0.7;

/**
 * The side-by-side confirm screen.
 *
 * Every field is editable and pre-filled with what the model read. Low-confidence
 * fields are marked in words as well as colour, because this is the screen that
 * decides whether something wrong gets written into a compliance record.
 */
export function ConfirmExtraction({ document, properties }: {
  document: PendingDocument;
  properties: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(confirmExtraction, null);
  const [kind, setKind] = useState(document.kind);

  if (state?.ok) {
    return (
      <Card className="stack">
        <Status tone="ok">Confirmed</Status>
        <p style={{ margin: 0 }}>
          {document.filename ?? "That document"} is now counted towards your compliance.
        </p>
      </Card>
    );
  }

  const flag = (field: string) => {
    const score = document.confidence[field];
    return score !== undefined && score < LOW_CONFIDENCE;
  };

  /**
   * Scope every element id to this document.
   *
   * Several pending documents render several of these forms at once. With fixed
   * ids the page carried duplicate IDs, so a <label for> could bind to another
   * document's field — a screen reader user would be editing the wrong
   * certificate without any indication. Caught by axe in the e2e run.
   */
  const fieldId = (name: string) => `${name}-${document.id}`;

  return (
    <Card className="stack">
      <div className="spread">
        <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>
          {document.filename ?? "Uploaded document"}
        </h3>
        <Status tone="warn">Needs your check</Status>
      </div>

      <form action={formAction} className="stack">
        <input type="hidden" name="document_id" value={document.id} />

        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        <Field label="What kind of document is it?" flagged={flag("kind")} id={fieldId("kind")}>
          <select id={fieldId("kind")} name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="gas_safety_record">Gas safety record</option>
            <option value="eicr">Electrical safety report (EICR)</option>
            <option value="eic">Electrical installation certificate (EIC)</option>
            <option value="epc">Energy performance certificate</option>
            <option value="licence">Licence</option>
            <option value="deposit_certificate">Deposit certificate</option>
            <option value="tenancy_agreement">Tenancy agreement</option>
            <option value="other">Something else</option>
          </select>
        </Field>

        <Field label="Which property is it for?" flagged={flag("property_address")} id={fieldId("property_id")}>
          <select id={fieldId("property_id")} name="property_id" defaultValue={document.propertyId ?? ""} required>
            <option value="">Choose a property</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>

        <Field label="Date it was issued" flagged={flag("issued_on")} id={fieldId("issued_on")}>
          <input id={fieldId("issued_on")} name="issued_on" type="date" defaultValue={document.issuedOn ?? ""} />
        </Field>

        <Field label="Valid until" flagged={flag("expires_on")} id={fieldId("expires_on")}>
          <input id={fieldId("expires_on")} name="expires_on" type="date" defaultValue={document.expiresOn ?? ""} />
        </Field>

        {kind === "eicr" || kind === "eic" ? (
          <Field label="What was the outcome?" flagged={flag("outcome")} id={fieldId("outcome")}>
            <select id={fieldId("outcome")} name="outcome" defaultValue={document.outcome}>
              <option value="satisfactory">Satisfactory</option>
              <option value="unsatisfactory">Unsatisfactory</option>
              <option value="unknown">It does not say</option>
            </select>
            <p className="hint" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
              An unsatisfactory report means the work has to be done within 28 days.
              We will open that for you.
            </p>
          </Field>
        ) : (
          <input type="hidden" name="outcome" value="not_applicable" />
        )}

        {kind === "epc" ? (
          <Field label="EPC rating" flagged={flag("epc_rating")} id={fieldId("epc_rating")}>
            <select id={fieldId("epc_rating")} name="epc_rating" defaultValue={document.epcRating ?? ""}>
              <option value="">Not sure</option>
              {["A", "B", "C", "D", "E", "F", "G"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        ) : null}

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "This is right — save it"}
          </button>
        </div>
      </form>
    </Card>
  );
}

function Field({ label, flagged, id, children }: {
  label: string; flagged: boolean; id: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {flagged ? (
        <p className="hint" style={{ color: "var(--warn)", fontWeight: 600 }}>
          We were not sure about this one — please check it against the document.
        </p>
      ) : null}
      {children}
    </div>
  );
}
