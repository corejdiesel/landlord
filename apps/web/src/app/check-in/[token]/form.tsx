"use client";

import { useActionState } from "react";
import { Card, Status } from "../../../components/ui";
import { submitCheckIn } from "./actions";

export function CheckInForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(submitCheckIn, null);

  if (state?.ok) {
    return (
      <Card className="stack">
        <Status tone="ok">Thank you</Status>
        <p style={{ margin: 0 }}>
          That is all we needed. You can close this page.
        </p>
      </Card>
    );
  }

  return (
    <Card className="stack">
      <form action={formAction} className="stack">
        <input type="hidden" name="token" value={token} />

        {state && !state.ok ? (
          <div role="alert"><Status tone="warn">{state.error}</Status></div>
        ) : null}

        <div>
          <label htmlFor="occupants">How many people live here permanently?</label>
          <p className="hint" id="occupants-hint">
            Include children and babies. Do not count visitors staying less than
            three months.
          </p>
          <input id="occupants" name="occupants" type="number" inputMode="numeric"
                 min={0} max={200} required aria-describedby="occupants-hint" />
        </div>

        <div>
          <label htmlFor="households">How many households is that?</label>
          <p className="hint" id="households-hint">
            One person or one family living together is one household. If you share
            with people you are not related to, count each of them separately.
          </p>
          <input id="households" name="households" type="number" inputMode="numeric"
                 min={0} max={50} required defaultValue={1} aria-describedby="households-hint" />
        </div>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Card>
  );
}
