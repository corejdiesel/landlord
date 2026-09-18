"use client";

import { useActionState } from "react";
import { Card, Status } from "../../../../components/ui";
import { recordRegistrationAction } from "../actions";

/**
 * Record a completed registration.
 *
 * Note what this is not: it does not submit anything. The landlord registers on
 * GOV.UK themselves and comes back with their numbers. The copy says so
 * plainly, because implying otherwise would be both a product lie and a
 * regulatory problem.
 */
export function RecordRegistrationForm({ propertyId }: { propertyId: string }) {
  const [state, formAction, pending] = useActionState(recordRegistrationAction, null);

  return (
    <details>
      <summary style={{ cursor: "pointer", minHeight: "var(--tap-min)", display: "flex", alignItems: "center" }}>
        Already registered on GOV.UK? Record your numbers
      </summary>
      <Card className="stack" style={{ marginTop: "var(--space-3)" }}>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          You register on GOV.UK yourself — we never touch that form. Put your
          numbers here and we will take over the rest: keeping the entry true,
          the 28-day clocks, and the renewal.
        </p>
        <form action={formAction} className="stack">
          <input type="hidden" name="property_id" value={propertyId} />

          {state?.ok ? <div role="status"><Status tone="ok">Recorded</Status></div> : null}
          {state && !state.ok ? <div role="alert"><Status tone="danger">{state.error}</Status></div> : null}

          <div>
            <label htmlFor="property_registration_number">Property registration number</label>
            <input id="property_registration_number" name="property_registration_number" type="text" required />
          </div>
          <div>
            <label htmlFor="landlord_registration_number">Your landlord registration number</label>
            <p className="hint" id="lrn-hint">Optional here if you have already recorded it elsewhere.</p>
            <input id="landlord_registration_number" name="landlord_registration_number" type="text"
                   aria-describedby="lrn-hint" />
          </div>
          <div>
            <label htmlFor="registered_on">When did you register?</label>
            <input id="registered_on" name="registered_on" type="date" required />
          </div>
          <div>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record registration"}
            </button>
          </div>
        </form>
      </Card>
    </details>
  );
}
