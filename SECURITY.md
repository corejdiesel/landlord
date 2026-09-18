# Security

Threat model and the controls that answer it. Written to be read by someone
deciding whether to trust this with tenant data.

Code-level rules live in `.claude/rules/security.md`.

---

## What we are protecting

1. **Landlords' personal data.** Home and correspondence addresses, emails,
   company details. The audience is scam-wary and privacy-anxious, and the
   product's pitch is partly that we behave better than the database they are
   worried about. A leak here is existential, not embarrassing.
2. **Tenants' data.** Deliberately almost none — see *Data minimisation*.
3. **The integrity of the compliance record.** If the Evidence Ledger can be
   edited, the Defence File is worthless and actively misleading.
4. **Availability of reminders.** A missed reminder is the failure mode the
   product exists to prevent.

---

## Threats, and what answers them

### T1 — One account reads another's data

*Row Level Security, enabled AND forced, on every table.* `FORCE` matters: the
application role owns these tables, and without it every policy would be inert
for exactly the connection the app uses.

Every account-scoped query runs through `withAccount`, which sets the RLS context
transaction-locally. Code that forgets gets a connection with no context, and RLS
returns zero rows — forgetting fails closed.

Tested: `test/rls.test.ts` proves an agent with no grant, an agent whose grant was
revoked, and an unrelated landlord all get zero rows; that RLS is forced on every
table; and that the test role is not a superuser (a superuser would bypass RLS and
the suite would prove nothing).

### T2 — An agent reads a landlord's data without permission

Access requires an `agent_grants` row created by the **landlord**. The RLS policy
lets only the landlord insert or revoke one, so an agent cannot grant itself
access even with full API access. Revocation is immediate: the rows disappear from
the agent's next query.

### T3 — The compliance record is altered after the fact

`ledger_events` is append-only, enforced twice and tested separately:

1. No UPDATE or DELETE policy, so an ordinary statement matches zero rows.
2. Triggers that reject UPDATE, DELETE and TRUNCATE outright.

Each row stores the SHA-256 of its payload plus the previous row's hash. The
genesis row's `prev_hash` is derived from the account id, so a chain cannot be
lifted from one account and replayed under another. `ledger_verify` walks the
chain and reports where it broke.

Tamper tests run over a dedicated `BYPASSRLS` connection, because the chain exists
for the attacker who is already past the application.

### T4 — The Tenant Passport leaks the landlord

The passport renders from an **allowlist** (`PUBLIC_FIELDS`), not a denylist. A
field added to `properties` cannot appear unless someone adds it to that list
deliberately. It never shows a landlord address, a date of birth or a document,
and it identifies the property by street and town rather than by house number, so
a shared link does not resolve to a precise address. The registration number is
off by default. Links are revocable and can expire.

### T5 — Enumeration of public links

Passport slugs are 16 random bytes (base64url, ~128 bits). Pulse, attestation and
co-owner tokens are 32 random bytes. All are stored as SHA-256 hashes, salted by
purpose, so a pulse token cannot be replayed as an attestation token and a
database leak does not hand over live links. The raw token exists in the URL and
nowhere else.

**Not yet done:** rate limiting on the public lookup endpoints. Listed in
`HANDOVER.md` as a pre-launch requirement.

### T6 — Inbound email spoofing

Inbound mail is routed by a per-account token in the address. Anyone who learns a
landlord's Cert Inbox address can post a document into their account.

Mitigations in place: nothing arriving by email touches compliance state — it
lands unconfirmed, and the rule engine ignores unconfirmed documents entirely. So
the worst case is a nuisance item in the confirm queue, not a false compliance
record.

**Not yet done:** SPF/DKIM/DMARC verification on the inbound webhook, and a
per-account allowlist of sender addresses. There is no real MX in this build.

### T7 — A malicious upload

MIME type is sniffed from magic bytes, not taken from the `Content-Type` header.
Size is capped at 20MB. A virus-scan hook is called before anything is written —
it is a stub here (no scanner to call), but it is a real call site that refuses
the EICAR test string, so wiring in ClamAV is one function body.

Files are served only from signed URLs, with `Content-Disposition: attachment`,
`Content-Type: application/octet-stream` and `nosniff`, so an uploaded file can
never execute in our origin. Storage keys that escape the storage root are
**refused**, not sanitised — an earlier version stripped `../` and carried on,
turning a traversal attempt into a different unintended write.

### T8 — An LLM writes something false into a compliance record

No model output changes compliance state. An extraction is stored with
`confirmed_at` null; the rule engine ignores unconfirmed documents; only a human
confirmation in the UI moves anything. The extraction prompt's first instruction
is to return `null` rather than guess, and per-field confidence is surfaced in
words as well as colour on the confirm screen.

Law Watch never edits a rule. It drafts a summary and opens an admin task;
publishing requires a human-written note, and even that publishes a "what
changed" entry rather than a rule change.

### T9 — Session theft

Session tokens are 32 random bytes; only the SHA-256 reaches the database. Cookies
are `httpOnly`, `sameSite=lax`, and `secure` outside development. Sessions expire
after 30 days and are revoked on sign-out.

Passwords use scrypt with a per-user salt. Sign-in runs the hash comparison even
when no user matched, so a missing account and a wrong password take about the
same time, and both report the same message.

### T10 — The bootstrap flag is abused

`app.bootstrap` is the one deliberate door in the RLS model. It exists because
signup, login, inbound routing and the public token surfaces all have to read
before any account context can exist.

It is transaction-local, it is raised only inside `SECURITY DEFINER` functions,
and application code never sets it. A test reads `pg_proc` and fails if a definer
function touching a protected table does not raise it — that invariant exists
because the same mistake (assuming `SECURITY DEFINER` bypasses `FORCE` RLS) shipped
four times, each time failing silently with zero rows.

**Honest limitation:** a caller who can already execute arbitrary SQL as the app
role can set the flag at session scope and read across accounts. The protection
is that nothing in the application does so, not that it is impossible. Closing
this properly means a separate role for the definer functions, noted in
`HANDOVER.md`.

---

## Data minimisation

The Household Pulse stores **two integers and a timestamp** per response. No name,
no contact details, nothing identifying an occupant. A test reads
`information_schema` and asserts the column list, so adding a column fails the
build — the tenant-facing page promises exactly this, and the promise should be
enforceable.

Tenant contact details are optional throughout: a landlord can print a slip or
record an answer by hand.

---

## Other controls

- **CSP** set in `next.config.ts`, with `frame-ancestors 'none'`, and
  `unsafe-eval` only in development.
- **No PII in logs.** Database errors are logged without the DSN; public
  endpoints return a generic message rather than a database error.
- **Soft deletes only.** Nothing is hard-deleted, so an accidental deletion is
  recoverable and the audit trail survives.
- **Money as `bigint` pennies** throughout — not a security control, but a
  correctness one that prevents a class of rounding disputes.

---

## Known gaps

Everything here is deliberate, because this is a local build with no deployment.

| Gap | Why | Needed before |
|---|---|---|
| No rate limiting | No edge in front of it | Launch |
| Virus scanner is a stub | No scanner available | Accepting real uploads |
| No SPF/DKIM on inbound mail | No real MX | Enabling the Cert Inbox |
| Bootstrap flag shares the app role | Cannot create a role with `BYPASSRLS` from a migration | Launch |
| No MFA | Not built | Agent tier at the latest |
| Secrets in `.env.local` | No secret manager locally | Deployment |
| No pgcrypto encryption of third-party tokens | No third-party tokens stored yet | Storing any |
