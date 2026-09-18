"use client";

import { useActionState } from "react";
import { formatUkLong } from "@letsorted/rules";
import { Card, Status } from "../../../../../components/ui";
import { confirmDriftUpdated } from "../../actions";

/**
 * "I have updated GOV.UK."
 *
 * Deliberately per-item rather than one big confirm: a landlord may update the
 * rent today and the occupants next week, and confirming only what they have
 * actually done keeps the remaining clocks honest.
 */
export function ConfirmDriftForm({ items }: {
  items: { id: string; label: string; newValue: string; dueOn: string; state: string }[];
}) {
  const [state, formAction, pending] = useActionState(confirmDriftUpdated, null);

  if (state?.ok) {
    return (
      <Card className="stack">
        <Status tone="ok">Recorded</Status>
        <p style={{ margin: 0 }}>
          We have noted that your entry is up to date, and it is in your record.
        </p>
      </Card>
    );
  }

  return (
    <Card className="stack">
      <h2 style={{ margin: 0 }}>Tick off what you have done</h2>
      <form action={formAction} className="stack">
        {state && !state.ok ? (
          <div role="alert"><Status tone="danger">{state.error}</Status></div>
        ) : null}

        <fieldset className="stack">
          <legend>Which of these have you changed on GOV.UK?</legend>
          {items.map((item) => (
            <label key={item.id} style={{ fontWeight: 400 }}>
              <input type="checkbox" name="drift_item_id" value={item.id} />{" "}
              {item.label} — now {item.newValue}
              <span style={{ color: "var(--ink-muted)" }}>
                {" "}(due {formatUkLong(item.dueOn)})
              </span>
            </label>
          ))}
        </fieldset>

        <p className="hint" style={{ margin: 0 }}>
          Only tick what you have actually changed. Anything left keeps its own
          deadline, and we will keep reminding you about it.
        </p>

        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "I have updated these on GOV.UK"}
          </button>
        </div>
      </form>
    </Card>
  );
}
