import type { ReactNode } from "react";
import { formatUkLong, type Obligation, type ObligationState, type RuleSource, type VerificationStatus } from "@letsorted/rules";

/**
 * The in-house component set. Small on purpose — no UI kit.
 *
 * Two rules run through all of it:
 *  - status is never carried by colour alone (glyph + word as well)
 *  - every countdown has a screen-reader label spelling out the date
 */

export function Card({ children, className = "", as: Tag = "div" }: {
  children: ReactNode; className?: string; as?: "div" | "section" | "article" | "li";
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export type StatusTone = "ok" | "warn" | "danger" | "info";

const GLYPH: Record<StatusTone, string> = { ok: "✓", warn: "!", danger: "×", info: "i" };

export function Status({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span className={`status status-${tone}`}>
      <span className="status-glyph" aria-hidden="true">{GLYPH[tone]}</span>
      <span>{children}</span>
    </span>
  );
}

/** Map an obligation state to a tone and a word. */
export function toneForState(state: ObligationState): { tone: StatusTone; label: string } {
  switch (state) {
    case "overdue": return { tone: "danger", label: "Overdue" };
    case "due_soon": return { tone: "warn", label: "Due soon" };
    case "blocked": return { tone: "danger", label: "Blocked" };
    case "satisfied": return { tone: "ok", label: "In order" };
    case "not_yet_applicable": return { tone: "info", label: "Not yet" };
    case "upcoming": return { tone: "info", label: "Upcoming" };
  }
}

/**
 * A countdown.
 *
 * The visible part is the big figure; the accessible name is the full sentence,
 * because "41" on its own tells a screen-reader user nothing.
 */
export function Countdown({ days, dueOn, verb = "remaining" }: {
  days: number; dueOn: string; verb?: string;
}) {
  const overdue = days < 0;
  const magnitude = Math.abs(days);
  const spoken = overdue
    ? `${magnitude} ${magnitude === 1 ? "day" : "days"} overdue, was due ${formatUkLong(dueOn)}`
    : `${magnitude} ${magnitude === 1 ? "day" : "days"} ${verb}, due ${formatUkLong(dueOn)}`;

  return (
    <span className="row" style={{ gap: "var(--space-3)", alignItems: "baseline" }}>
      <span className="visually-hidden">{spoken}</span>
      <span aria-hidden="true" className="countdown" style={{ color: overdue ? "var(--danger)" : undefined }}>
        {magnitude}
      </span>
      <span aria-hidden="true" className="countdown-unit">
        {magnitude === 1 ? "day" : "days"} {overdue ? "overdue" : verb}
      </span>
    </span>
  );
}

/** A dated stamp on something completed. Used sparingly. */
export function Stamp({ label, date }: { label: string; date: string }) {
  return (
    <span className="stamp" role="img" aria-label={`${label} on ${formatUkLong(date)}`}>
      <span aria-hidden="true">{label}</span>
      <span aria-hidden="true" className="stamp-date">{formatUkLong(date)}</span>
    </span>
  );
}

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified_primary: "Checked against the legislation",
  verified_secondary: "Checked against government guidance",
  unverified: "Not yet verified — shown for information only",
};

/**
 * Provenance for any compliance statement.
 *
 * Product principle 2: every claim has a source and a date, and you can see both.
 * A <details> rather than a tooltip, because tooltips are hover-only and this
 * audience is substantially on touch devices.
 */
export function Provenance({ sources, verification, status }: {
  sources: RuleSource[]; verification: VerificationStatus; status?: string;
}) {
  return (
    <details className="provenance">
      <summary style={{ cursor: "pointer", minHeight: "var(--tap-min)", display: "flex", alignItems: "center" }}>
        Where this comes from
      </summary>
      <div className="stack" style={{ marginTop: "var(--space-3)" }}>
        <p style={{ margin: 0 }}>{VERIFICATION_LABEL[verification]}</p>
        {status ? <p style={{ margin: 0 }}>Status: {humanStatus(status)}</p> : null}
        <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
          {sources.map((s) => (
            <li key={s.url} style={{ marginBottom: "var(--space-2)" }}>
              <a href={s.url} rel="noopener noreferrer" target="_blank">{s.label}</a>
              {" — "}
              <span>we last checked this on <time dateTime={s.checked_on}>{formatUkLong(s.checked_on)}</time></span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export function humanStatus(status: string): string {
  switch (status) {
    case "in_force": return "In force";
    case "commencing": return "Coming into force";
    case "draft": return "Draft";
    case "proposed": return "Proposed only";
    case "not_commenced": return "Passed but not yet in force";
    default: return status;
  }
}

/** The fixed footer on any screen stating a legal position. */
export function LegalFooter() {
  return (
    <p className="footer-note">
      General information, not legal advice. Sources and dates shown.
    </p>
  );
}

/** One obligation, as it appears on the dashboard and property pages. */
export function ObligationRow({ obligation }: { obligation: Obligation }) {
  const { tone, label } = toneForState(obligation.state);
  return (
    <Card as="li" className="stack">
      <div className="spread">
        <h3 style={{ margin: 0 }}>{obligation.title}</h3>
        <Status tone={tone}>{label}</Status>
      </div>
      <p style={{ margin: 0 }}>{obligation.reason}</p>
      {obligation.due_on && obligation.state !== "satisfied" ? (
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          Due <time dateTime={obligation.due_on}>{formatUkLong(obligation.due_on)}</time>
          {obligation.days_remaining !== null ? (
            <> — {obligation.days_remaining < 0
              ? `${Math.abs(obligation.days_remaining)} days ago`
              : `${obligation.days_remaining} days from now`}</>
          ) : null}
        </p>
      ) : null}
      <Provenance
        sources={obligation.sources}
        verification={obligation.verification_status}
        status={obligation.status}
      />
    </Card>
  );
}

/** Money, from pennies. The only renderer for a monetary value. */
export function formatPennies(pennies: bigint): string {
  const negative = pennies < 0n;
  const abs = negative ? -pennies : pennies;
  const pounds = abs / 100n;
  const rem = abs % 100n;
  const withCommas = pounds.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}£${withCommas}${rem === 0n ? "" : `.${rem.toString().padStart(2, "0")}`}`;
}

export function Money({ pennies }: { pennies: bigint }) {
  return <span className="money">{formatPennies(pennies)}</span>;
}
