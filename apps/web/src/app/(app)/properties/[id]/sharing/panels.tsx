"use client";

import { useActionState } from "react";
import { Card, Status } from "../../../../../components/ui";
import { createCheckIn, createPropertyPassport, revokePropertyPassport } from "./actions";

export function CheckInPanel({ propertyId }: { propertyId: string }) {
  const [state, formAction, pending] = useActionState(createCheckIn, null);
  const link = state?.ok && state.data && typeof state.data === "object" && "link" in state.data
    ? (state.data as { link: string }).link : null;

  return (
    <Card className="stack">
      <form action={formAction} className="stack">
        <input type="hidden" name="property_id" value={propertyId} />

        {state && !state.ok ? <div role="alert"><Status tone="danger">{state.error}</Status></div> : null}

        <div>
          <label htmlFor="tenant_email">Your tenant&rsquo;s email address</label>
          <p className="hint" id="tenant-email-hint">
            Optional. Leave it blank and we will just give you the link to send or
            print however you like.
          </p>
          <input id="tenant_email" name="tenant_email" type="email" aria-describedby="tenant-email-hint" />
        </div>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create a check-in link"}
          </button>
        </div>
      </form>

      {link ? (
        <div className="stack">
          <Status tone="ok">Link ready</Status>
          <p style={{ margin: 0, wordBreak: "break-all" }}>{link}</p>
          <p className="hint" style={{ margin: 0 }}>
            It works once, and expires in 30 days.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

const FIELDS: { key: string; label: string; defaultOn: boolean; note?: string }[] = [
  { key: "registered", label: "That the property is registered", defaultOn: true },
  { key: "registration_number", label: "The registration number itself", defaultOn: false,
    note: "Off by default. It is yours to disclose, not ours." },
  { key: "gas_in_date", label: "Gas safety check is in date", defaultOn: true },
  { key: "electrical_in_date", label: "Electrical report is in date", defaultOn: true },
  { key: "epc_rating", label: "Energy rating", defaultOn: true },
  { key: "licence_held", label: "Council licence", defaultOn: true },
  { key: "deposit_scheme", label: "Which deposit scheme", defaultOn: true },
];

export function PassportPanel({ propertyId, mode, slug }: {
  propertyId: string; mode: "create" | "revoke"; slug?: string;
}) {
  const [createState, createAction, creating] = useActionState(createPropertyPassport, null);
  const [, revokeAction, revoking] = useActionState(revokePropertyPassport, null);

  if (mode === "revoke") {
    return (
      <form action={revokeAction}>
        <input type="hidden" name="property_id" value={propertyId} />
        <input type="hidden" name="slug" value={slug ?? ""} />
        <button className="btn btn-quiet" type="submit" disabled={revoking}>
          {revoking ? "Withdrawing…" : "Withdraw this page"}
        </button>
      </form>
    );
  }

  const link = createState?.ok && createState.data && typeof createState.data === "object" && "link" in createState.data
    ? (createState.data as { link: string }).link : null;

  return (
    <Card className="stack">
      <form action={createAction} className="stack">
        <input type="hidden" name="property_id" value={propertyId} />

        <fieldset className="stack">
          <legend>What should the page show?</legend>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label style={{ fontWeight: 400 }}>
                <input type="checkbox" name={`show_${f.key}`} defaultChecked={f.defaultOn} />{" "}
                {f.label}
              </label>
              {f.note ? <p className="hint" style={{ margin: 0 }}>{f.note}</p> : null}
            </div>
          ))}
        </fieldset>

        <p className="hint" style={{ margin: 0 }}>
          Whatever you choose, the page never shows your address, your date of birth,
          or any document. It identifies the property by street, not by number.
        </p>

        <div>
          <button className="btn" type="submit" disabled={creating}>
            {creating ? "Publishing…" : "Publish the page"}
          </button>
        </div>
      </form>

      {link ? (
        <div className="stack">
          <Status tone="ok">Published</Status>
          <p style={{ margin: 0, wordBreak: "break-all" }}>{link}</p>
        </div>
      ) : null}
    </Card>
  );
}
