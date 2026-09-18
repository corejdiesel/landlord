"use client";

import { useActionState, useState } from "react";
import { Card, Status } from "../../../components/ui";
import { submitAttestation } from "./actions";

export function AttestationForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(submitAttestation, null);
  const [disputing, setDisputing] = useState(false);

  if (state?.ok) {
    return (
      <Card className="stack">
        <Status tone="ok">Recorded</Status>
        <p style={{ margin: 0 }}>
          Thank you. Your answer is now in your record and your agent&rsquo;s.
        </p>
      </Card>
    );
  }

  return (
    <Card className="stack">
      {state && !state.ok ? (
        <div role="alert"><Status tone="warn">{state.error}</Status></div>
      ) : null}

      {!disputing ? (
        <form action={formAction} className="stack">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="confirmed" />
          <div className="row">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Yes, that is right"}
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => setDisputing(true)}>
              No, that is not right
            </button>
          </div>
        </form>
      ) : (
        <form action={formAction} className="stack">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decision" value="disputed" />
          <div>
            <label htmlFor="note">What is wrong with it?</label>
            <p className="hint" id="note-hint">
              Optional, but it saves a phone call. Your agent will see this.
            </p>
            <textarea id="note" name="note" rows={3} aria-describedby="note-hint" />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Saving…" : "Send this to my agent"}
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => setDisputing(false)}>
              Back
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
