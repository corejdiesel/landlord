import type { PoolClient } from "pg";
import {
  ALL_RULES, DRIFT_REMINDER_DAYS, addDays, daysBetween, evaluate, formatUkLong,
  type Obligation,
} from "@letsorted/rules";
import { adapters } from "../adapters/index";
import { appendLedger, withAccount, type AccountContext } from "./db";
import { evaluationInputFor, listProperties, propertyLabel } from "./repository";

/**
 * Reminder engine.
 *
 * Missed reminders are the nightmare scenario for this product, so:
 *  - scheduling is idempotent (a unique constraint per target/channel/day), so
 *    running the job twice cannot double-send or reset anything
 *  - every send is written to the ledger, so a landlord can show what they were
 *    told and when
 *  - the channel is email, backed up by in-app and the ICS feed, because push
 *    on iOS only works after Add to Home Screen and must never carry a legal
 *    deadline on its own
 */

/** Days before an obligation's due date that we send a reminder. */
export const OBLIGATION_REMINDER_DAYS = [30, 14, 7, 1] as const;
/** Days before a renewal. Renewal is manual, so the run-up is longer. */
export const RENEWAL_REMINDER_DAYS = [30, 14, 7, 1] as const;

export type ScheduledReminder = {
  accountId: string;
  obligationId: string | null;
  driftItemId: string | null;
  registrationId: string | null;
  /**
   * Names the exact target and offset, e.g.
   * "obligation:<propertyId>:PRS-REG-DWELLING:30".
   *
   * Never null, which the id columns are. A unique index over nullable columns
   * never fires, because NULL <> NULL — see migration 0010.
   */
  dedupeKey: string;
  scheduledFor: string;
  subject: string;
  body: string;
};

function obligationReminder(
  o: Obligation, property: string, daysBefore: number,
): { subject: string; body: string } {
  const when = daysBefore === 1 ? "tomorrow" : `in ${daysBefore} days`;
  return {
    subject: `${o.title} — due ${when}`,
    body: [
      `${o.title} for ${property} is due on ${formatUkLong(o.due_on!)}, which is ${when}.`,
      "",
      o.reason,
      "",
      "Sign in to see what to do about it.",
      "",
      "General information, not legal advice. Sources and dates shown in the app.",
    ].join("\n"),
  };
}

/**
 * Work out every reminder that should exist today.
 *
 * Pure-ish: it reads, but writes nothing, so it can be inspected in a dev route
 * before anything is sent.
 */
export async function planReminders(
  ctx: AccountContext,
  today: string,
): Promise<ScheduledReminder[]> {
  const properties = await listProperties(ctx);

  return withAccount(ctx, async (client) => {
    const planned: ScheduledReminder[] = [];

    for (const property of properties) {
      const input = await evaluationInputFor(client, property.id, today);
      if (!input) continue;

      const label = propertyLabel(property);

      for (const o of evaluate(input, ALL_RULES, {})) {
        if (!o.due_on) continue;
        if (o.state === "satisfied" || o.state === "not_yet_applicable") continue;

        for (const daysBefore of OBLIGATION_REMINDER_DAYS) {
          const scheduledFor = addDays(o.due_on, -daysBefore);
          if (scheduledFor !== today) continue;
          const { subject, body } = obligationReminder(o, label, daysBefore);
          planned.push({
            accountId: ctx.accountId,
            obligationId: null,
            driftItemId: null,
            registrationId: null,
            dedupeKey: `obligation:${property.id}:${o.rule_id}:${daysBefore}`,
            scheduledFor, subject, body,
          });
        }
      }
    }

    // Drift items escalate on their own schedule: 14, 7, 3 and 1 days.
    const { rows: drift } = await client.query<{
      id: string; field_label: string; due_on: string; line1: string; postcode: string;
    }>(
      `select d.id, d.field_label, to_char(d.due_on, 'YYYY-MM-DD') as due_on, p.line1, p.postcode
         from live_drift_items d
         join live_registrations r on r.id = d.registration_id
         join live_properties p on p.id = r.property_id
        where d.closed_at is null`,
    );

    for (const item of drift) {
      for (const daysBefore of DRIFT_REMINDER_DAYS) {
        if (addDays(item.due_on, -daysBefore) !== today) continue;
        planned.push({
          accountId: ctx.accountId,
          obligationId: null,
          driftItemId: item.id,
          registrationId: null,
          dedupeKey: `drift:${item.id}:${daysBefore}`,
          scheduledFor: today,
          subject: `Your GOV.UK entry needs updating — ${daysBefore === 1 ? "tomorrow" : `${daysBefore} days left`}`,
          body: [
            `${item.field_label} changed at ${item.line1}, ${item.postcode}, and your database entry still shows the old value.`,
            "",
            `You have until ${formatUkLong(item.due_on)} to update it.`,
            "",
            "Sign in and we will show you exactly what to change.",
          ].join("\n"),
        });
      }
    }

    // Renewals. An entry that lapses goes inactive, so this one matters.
    const { rows: renewals } = await client.query<{
      id: string; renewal_due_on: string; line1: string; postcode: string;
    }>(
      `select r.id, to_char(r.renewal_due_on, 'YYYY-MM-DD') as renewal_due_on, p.line1, p.postcode
         from live_registrations r
         join live_properties p on p.id = r.property_id
        where r.status = 'active' and r.renewal_due_on is not null`,
    );

    for (const renewal of renewals) {
      for (const daysBefore of RENEWAL_REMINDER_DAYS) {
        if (addDays(renewal.renewal_due_on, -daysBefore) !== today) continue;
        planned.push({
          accountId: ctx.accountId,
          obligationId: null,
          driftItemId: null,
          registrationId: renewal.id,
          dedupeKey: `renewal:${renewal.id}:${daysBefore}`,
          scheduledFor: today,
          subject: `Renew your registration — ${daysBefore === 1 ? "tomorrow" : `${daysBefore} days left`}`,
          body: [
            `Your entry for ${renewal.line1}, ${renewal.postcode} renews on ${formatUkLong(renewal.renewal_due_on)}.`,
            "",
            "Renewal is manual — the government will not take it automatically, because you have to",
            "confirm the details are still correct. If it lapses, the entry goes inactive.",
            "",
            "Sign in for the list of everything to re-confirm.",
          ].join("\n"),
        });
      }
    }

    return planned;
  });
}

/**
 * Schedule and send. Idempotent: the unique constraint means a second run
 * inserts nothing and sends nothing.
 */
export async function runReminders(
  ctx: AccountContext,
  today: string,
): Promise<{ scheduled: number; sent: number }> {
  const planned = await planReminders(ctx, today);
  const { email } = adapters();

  return withAccount(ctx, async (client) => {
    let scheduled = 0;
    let sent = 0;

    for (const reminder of planned) {
      const { rows } = await client.query<{ id: string }>(
        `insert into reminders
           (account_id, obligation_id, drift_item_id, registration_id, channel,
            subject, body, scheduled_for, dedupe_key)
         values ($1, $2, $3, $4, 'email', $5, $6, $7::date, $8)
         on conflict (account_id, dedupe_key, channel, scheduled_for) do nothing
         returning id`,
        [reminder.accountId, reminder.obligationId, reminder.driftItemId,
         reminder.registrationId, reminder.subject, reminder.body,
         reminder.scheduledFor, reminder.dedupeKey],
      );
      const row = rows[0];
      if (!row) continue; // Already scheduled: do not send again.
      scheduled++;

      const address = await accountEmail(client, ctx.accountId);
      if (!address) continue;

      const result = await email.send({ to: address, subject: reminder.subject, text: reminder.body });
      if (result.ok) {
        await client.query("update reminders set sent_at = now() where id = $1", [row.id]);
        // Ledgered, so a landlord can show they were told and when.
        await appendLedger(client, ctx.accountId, "reminder.sent", {
          reminder_id: row.id,
          subject: reminder.subject,
          channel: "email",
          scheduled_for: reminder.scheduledFor,
        });
        sent++;
      }
    }

    return { scheduled, sent };
  });
}

async function accountEmail(client: PoolClient, accountId: string): Promise<string | null> {
  const { rows } = await client.query<{ email: string }>(
    `select u.email from live_memberships m
       join users u on u.id = m.user_id
      where m.account_id = $1 and m.role = 'owner'
      order by m.created_at asc limit 1`,
    [accountId],
  );
  return rows[0]?.email ?? null;
}

/**
 * Private ICS feed.
 *
 * Deliberately redundant with email: a calendar subscription keeps working even
 * if our mail stops, and a legal deadline should never depend on one channel.
 */
export async function buildIcsFeed(ctx: AccountContext, today: string): Promise<string> {
  const properties = await listProperties(ctx);

  const events = await withAccount(ctx, async (client) => {
    const out: { uid: string; date: string; summary: string; description: string }[] = [];

    for (const property of properties) {
      const input = await evaluationInputFor(client, property.id, today);
      if (!input) continue;
      const label = propertyLabel(property);

      for (const o of evaluate(input, ALL_RULES, {})) {
        if (!o.due_on || o.state === "satisfied" || o.state === "not_yet_applicable") continue;
        out.push({
          uid: `${o.rule_id}-${property.id}@letsorted`,
          date: o.due_on,
          summary: `${o.title} — ${label}`,
          description: o.reason,
        });
      }
    }

    const { rows: drift } = await client.query<{
      id: string; field_label: string; due_on: string; line1: string;
    }>(
      `select d.id, d.field_label, to_char(d.due_on, 'YYYY-MM-DD') as due_on, p.line1
         from live_drift_items d
         join live_registrations r on r.id = d.registration_id
         join live_properties p on p.id = r.property_id
        where d.closed_at is null`,
    );
    for (const item of drift) {
      out.push({
        uid: `drift-${item.id}@letsorted`,
        date: item.due_on,
        summary: `Update GOV.UK: ${item.field_label} — ${item.line1}`,
        description: "Your database entry is out of date. You have 28 days from the change.",
      });
    }

    return out;
  });

  return renderIcs(events);
}

/** Minimal RFC 5545 output. All-day events, because deadlines are dates. */
export function renderIcs(
  events: { uid: string; date: string; summary: string; description: string }[],
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Let Sorted//Compliance deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Let Sorted deadlines",
  ];

  for (const event of events) {
    const stamp = event.date.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${stamp}T000000Z`,
      `DTSTART;VALUE=DATE:${stamp}`,
      // An all-day event's DTEND is exclusive, so it is the following day.
      `DTEND;VALUE=DATE:${addDays(event.date, 1).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(event.summary)}`,
      `DESCRIPTION:${escapeIcs(event.description)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings; some clients genuinely reject LF.
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold at 75 octets, as the spec requires, with a leading space on the rest. */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

export { daysBetween };
