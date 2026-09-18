"use client";

import { useState, useTransition } from "react";
import { formatUkLong } from "@letsorted/rules";
import { Card, Countdown, LegalFooter, Money, Status } from "../components/ui";
import { captureSignup, lookupRadar, type RadarLookupResult } from "./radar-actions";

/**
 * The Deadline Radar form and result.
 *
 * Progressive in spirit: one text field that accepts one postcode or a pasted
 * list, no account, no jargon, and an answer that leads with the date rather
 * than with the penalty.
 */
export function RadarForm() {
  const [result, setResult] = useState<RadarLookupResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <section className="stack-lg" aria-labelledby="radar-heading">
      <Card className="stack">
        <h2 id="radar-heading" style={{ marginBottom: 0 }}>Check your dates</h2>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(async () => setResult(await lookupRadar(data)));
          }}
        >
          <div>
            <label htmlFor="postcodes">Postcode of the property you let</label>
            <p className="hint" id="postcodes-hint">
              More than one? Put them all in, separated by commas or on separate lines.
            </p>
            <textarea
              id="postcodes"
              name="postcodes"
              rows={3}
              required
              autoComplete="postal-code"
              aria-describedby="postcodes-hint"
              placeholder="B1 1AA"
            />
          </div>
          <div>
            <button className="btn" type="submit" disabled={pending}>
              {pending ? "Checking…" : "Show my dates"}
            </button>
          </div>
        </form>
      </Card>

      {result && !result.ok ? (
        <Card className="stack" aria-live="polite">
          <Status tone="warn">Check that</Status>
          <p style={{ margin: 0 }}>{result.error}</p>
        </Card>
      ) : null}

      {result?.ok ? <RadarResult result={result} /> : null}
    </section>
  );
}

function RadarResult({ result }: { result: Extract<RadarLookupResult, { ok: true }> }) {
  const { radar, approximate, rejected } = result;
  const first = radar.entries[0];

  return (
    <div className="stack-lg" aria-live="polite">
      {radar.entries.map((entry) => (
        <Card key={entry.region} className="stack">
          <div className="spread">
            <h3 style={{ margin: 0 }}>{entry.region_label}</h3>
            <Status tone={entry.state === "deadline_passed" ? "danger" : entry.state === "open_now" ? "warn" : "info"}>
              {entry.state === "deadline_passed" ? "Deadline passed"
                : entry.state === "open_now" ? "Open now"
                : "Not open yet"}
            </Status>
          </div>

          <Countdown
            days={entry.state === "not_open_yet" ? entry.days_until_open : entry.days_until_deadline}
            dueOn={entry.state === "not_open_yet" ? entry.commences_on : entry.deadline_on}
            verb={entry.state === "not_open_yet" ? "until you can register" : "to register"}
          />

          <p style={{ margin: 0, fontSize: "var(--text-lg)" }}>{entry.headline}</p>

          <table>
            <caption className="visually-hidden">Key dates for {entry.region_label}</caption>
            <tbody>
              <tr>
                <th scope="row">Registration opens</th>
                <td className="num"><time dateTime={entry.commences_on}>{formatUkLong(entry.commences_on)}</time></td>
              </tr>
              <tr>
                <th scope="row">You must be registered by</th>
                <td className="num"><time dateTime={entry.deadline_on}>{formatUkLong(entry.deadline_on)}</time></td>
              </tr>
              <tr>
                <th scope="row">Your properties here</th>
                <td className="num">{entry.postcodes.join(", ")}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      ))}

      <Card className="stack">
        <h3 style={{ margin: 0 }}>What it will cost</h3>
        <p style={{ margin: 0, fontSize: "var(--text-xl)" }}>
          <Money pennies={radar.annual_cost_pennies} /> a year
          <span style={{ color: "var(--ink-muted)", fontSize: "var(--text-base)" }}>
            {" "}for {radar.property_count} propert{radar.property_count === 1 ? "y" : "ies"}
          </span>
        </p>
        <p style={{ margin: 0, color: "var(--ink-muted)" }}>
          £65 per property per year. Registering yourself as a landlord is free.
        </p>
        {radar.entries.length > 1 && first ? (
          <p style={{ margin: 0 }}>
            Your earliest deadline is{" "}
            <strong><time dateTime={first.deadline_on}>{formatUkLong(first.deadline_on)}</time></strong>{" "}
            for {first.region_label}. That is the one that bites first.
          </p>
        ) : null}
      </Card>

      {approximate.length > 0 ? (
        <Card className="stack card-quiet">
          <Status tone="info">Worth checking</Status>
          <p style={{ margin: 0 }}>
            We placed {approximate.join(", ")} using a bundled lookup rather than a live
            one, so the region is our best guess. A few postcode areas straddle a
            regional boundary — worth confirming before you rely on the date.
          </p>
        </Card>
      ) : null}

      {rejected.length > 0 ? (
        <Card className="stack card-quiet">
          <Status tone="warn">We skipped some</Status>
          <ul style={{ margin: 0, paddingLeft: "1.2em" }}>
            {rejected.map((r) => <li key={r.postcode}>{r.postcode} — {r.reason}</li>)}
          </ul>
        </Card>
      ) : null}

      <SignupCard
        region={first?.region ?? ""}
        postcode={first?.postcodes[0] ?? ""}
        count={radar.property_count}
      />

      <LegalFooter />
    </div>
  );
}

function SignupCard({ region, postcode, count }: { region: string; postcode: string; count: number }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <Card className="stack">
        <Status tone="ok">That is set</Status>
        <p style={{ margin: 0 }}>
          We will email you when your window opens, and again before your deadline.
          Nothing else — you can stop them at any time from any of those emails.
        </p>
      </Card>
    );
  }

  return (
    <Card className="stack">
      <h3 style={{ margin: 0 }}>Remind me when my window opens</h3>
      <p style={{ margin: 0, color: "var(--ink-muted)" }}>
        One email when registration opens for your region, one before the deadline.
      </p>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startTransition(async () => {
            const res = await captureSignup(data);
            if (res.ok) setDone(true);
            else setError(res.error);
          });
        }}
      >
        <input type="hidden" name="region" value={region} />
        <input type="hidden" name="postcode" value={postcode} />
        <input type="hidden" name="count" value={String(count)} />
        <div>
          <label htmlFor="radar-email">Your email address</label>
          <input id="radar-email" name="email" type="email" required autoComplete="email" />
        </div>
        {error ? <p style={{ margin: 0, color: "var(--danger)" }}>{error}</p> : null}
        <div>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Remind me"}
          </button>
        </div>
      </form>
    </Card>
  );
}
