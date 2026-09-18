"use client";

import { useActionState, useState } from "react";
import { Card, Status } from "../../../../components/ui";
import { submitReview, triggerRun } from "./actions";

export function RunButton() {
  const [state, action, pending] = useActionState(async () => triggerRun(), null);

  return (
    <form action={action} className="row">
      <button className="btn btn-secondary" type="submit" disabled={pending}>
        {pending ? "Checking…" : "Check the sources now"}
      </button>
      {state?.ok && state.message ? (
        <span role="status" style={{ color: "var(--ink-muted)" }}>{state.message}</span>
      ) : null}
      {state && !state.ok ? (
        <span role="alert" style={{ color: "var(--danger)" }}>{state.error}</span>
      ) : null}
    </form>
  );
}

export function ReviewPanel({ changeId, draft }: { changeId: string; draft: string }) {
  const [state, formAction, pending] = useActionState(submitReview, null);
  const [summary, setSummary] = useState("");

  if (state?.ok) {
    return (
      <div><Status tone="ok">Reviewed</Status></div>
    );
  }

  return (
    <Card className="stack card-quiet">
      <form action={formAction} className="stack">
        <input type="hidden" name="change_id" value={changeId} />

        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        <div>
          <label htmlFor={`summary-${changeId}`}>Your note for users</label>
          <p className="hint" id={`summary-hint-${changeId}`}>
            In your own words. This is what landlords will read, so it has to be
            right — the model&rsquo;s draft is a starting point, not the note.
          </p>
          <textarea
            id={`summary-${changeId}`}
            name="summary"
            rows={4}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            aria-describedby={`summary-hint-${changeId}`}
          />
          {draft ? (
            <button type="button" className="btn btn-quiet" style={{ marginTop: "var(--space-2)" }}
                    onClick={() => setSummary(draft)}>
              Start from the model&rsquo;s draft
            </button>
          ) : null}
        </div>

        <div className="row">
          <button className="btn" type="submit" name="decision" value="approved" disabled={pending}>
            Publish this note
          </button>
          <button className="btn btn-quiet" type="submit" name="decision" value="rejected" disabled={pending}>
            Not worth publishing
          </button>
        </div>
      </form>
    </Card>
  );
}
