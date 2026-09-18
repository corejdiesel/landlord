# Security rules

Full threat model in `SECURITY.md`. These are the rules for writing code.

## The GOV.UK boundary

- Never automate, script, scrape or drive the GOV.UK registration service.
- Never ask for, store, or transmit GOV.UK One Login credentials.
- Never imply we submit on a user's behalf. We prepare; the landlord submits.

This is an absolute product boundary, not a technical limitation to route around.

## Tenant data

Collect the least possible. The Household Pulse stores exactly two integers and
a timestamp per response — no name, no contact details, nothing identifying. If
you are adding a column to a `pulse_*` table, you are probably doing it wrong.

## Tokens and links

Every tokenised link (passport, pulse, attestation, co-owner invite) is:
- single-purpose,
- long and random enough not to be enumerable,
- stored as a hash, never in plaintext,
- expiring, and revocable.

The raw token exists in the URL and nowhere else. Look it up by hash.

## The Tenant Passport must never leak

- no landlord home or correspondence address
- no date of birth
- no documents unless individually opted in
- no landlord registration number unless the landlord chose to show it

Slugs must not be enumerable. Test this.

## Database

- RLS enabled AND forced on every table. A new table without a tested policy is
  a bug, not a TODO.
- Account-scoped access goes through `withAccount`. Never build a query that
  takes an `account_id` from user input and trusts it.
- The bootstrap flag (`app.bootstrap`) is set only inside the signup and public
  definer functions. Application code must never set it.

## Uploads

MIME sniffing, size limits, a virus-scan hook, signed URLs for retrieval. Never
serve an uploaded file from the same origin without a Content-Disposition and a
strict content type.

## Logs

No PII in logs. No tokens, no email addresses, no DSNs. Audit every admin action.

## LLM calls

Redact personal data the task does not need. Validate output with Zod. The
extraction prompt must return `null` rather than guess — a confident wrong
expiry date on a gas certificate is worse than no answer.
