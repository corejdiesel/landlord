"use client";

import { useActionState } from "react";
import { Card, Status } from "../../../components/ui";
import { simulateInboundEmail, uploadDocument } from "./actions";

export function UploadForm({ properties }: { properties: { id: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState(uploadDocument, null);

  return (
    <Card className="stack">
      <h2 style={{ margin: 0 }}>Add a certificate</h2>
      <form action={formAction} className="stack">
        {state?.ok ? (
          <div role="status"><Status tone="ok">Read. Check it below before we count it.</Status></div>
        ) : null}
        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        <div>
          <label htmlFor="file">Choose a file or take a photo</label>
          <p className="hint" id="file-hint">
            A PDF or a photo, up to 20MB. We will read the dates off it for you.
          </p>
          <input id="file" name="file" type="file" required
                 accept="application/pdf,image/*,text/plain" aria-describedby="file-hint" />
        </div>

        <div>
          <label htmlFor="property_id">Which property is it for?</label>
          <p className="hint" id="property-hint">
            Leave this if you are not sure — we will try to work it out from the address.
          </p>
          <select id="property_id" name="property_id" defaultValue="" aria-describedby="property-hint">
            <option value="">Work it out from the document</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Reading…" : "Upload"}
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Inbound email simulator.
 *
 * Runs the identical ingest path a real webhook would, so what it exercises is
 * the real thing minus the transport.
 */
export function InboundSimulator() {
  const [state, formAction, pending] = useActionState(simulateInboundEmail, null);

  return (
    <details>
      <summary style={{ cursor: "pointer", minHeight: "var(--tap-min)", display: "flex", alignItems: "center" }}>
        Simulate a forwarded email
      </summary>
      <Card className="stack" style={{ marginTop: "var(--space-3)" }}>
        <form action={formAction} className="stack">
          {state?.ok ? <div role="status"><Status tone="ok">Delivered. It is waiting above.</Status></div> : null}
          {state && !state.ok ? <div role="alert"><Status tone="danger">{state.error}</Status></div> : null}

          <div>
            <label htmlFor="subject">Subject</label>
            <input id="subject" name="subject" type="text" defaultValue="Gas safety record for 12 Acacia Road" />
          </div>
          <div>
            <label htmlFor="filename">Attachment filename</label>
            <input id="filename" name="filename" type="text" defaultValue="gas-safety-record.txt" />
          </div>
          <div>
            <label htmlFor="body">Attachment contents</label>
            <p className="hint" id="body-hint">
              Stands in for the file itself. Put an address and a date in it to see the
              extraction and the property match work.
            </p>
            <textarea id="body" name="body" rows={5} aria-describedby="body-hint"
              defaultValue={"Landlord Gas Safety Record\n12 Acacia Road, Birmingham\nInspection date 05/01/2027\nEngineer 123456\nAll appliances passed"} />
          </div>
          <div>
            <button className="btn btn-secondary" type="submit" disabled={pending}>
              {pending ? "Delivering…" : "Deliver to my inbox"}
            </button>
          </div>
        </form>
      </Card>
    </details>
  );
}
