"use client";

import { useState } from "react";
import { Card, Status } from "../../../../../components/ui";

/**
 * One prepared answer, with a copy button.
 *
 * The copy button is the whole point of the pack: the landlord has GOV.UK open
 * in another tab and should never have to retype anything or go looking for it.
 */
export function CopyableAnswer({ question, value, help, required }: {
  question: string; value: string | null; help: string | null; required: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Card as="li" className="stack">
      <div className="spread">
        <h3 style={{ margin: 0, fontSize: "var(--text-base)" }}>{question}</h3>
        {!value && required ? <Status tone="warn">Needed</Status> : null}
      </div>
      {help ? <p className="hint" style={{ margin: 0 }}>{help}</p> : null}

      {value ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong style={{ fontSize: "var(--text-lg)", fontVariantNumeric: "tabular-nums" }}>{value}</strong>
          <button
            type="button"
            className="btn btn-quiet no-print"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard can be blocked by permissions or an insecure origin.
                // The value is on screen either way, so this is not worth an alert.
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <span role="status" aria-live="polite" className="visually-hidden">
            {copied ? `${question} copied to the clipboard` : ""}
          </span>
        </div>
      ) : (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          {required ? "You will need to answer this on the day." : "Not needed unless it applies to you."}
        </p>
      )}
    </Card>
  );
}

/**
 * Print the pack.
 *
 * A real button, not a link: the print stylesheet does the work, and a paper
 * route genuinely exists for the government service, so this has to produce
 * something a landlord can sit down with at a kitchen table.
 */
export function PrintPackButton() {
  return (
    <button type="button" className="btn btn-secondary no-print" onClick={() => window.print()}>
      Print this pack
    </button>
  );
}
