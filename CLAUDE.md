# Let Sorted — working notes

A compliance cockpit for private landlords in England under the Renters' Rights
Act 2025 and the "Register your rental property" service (the PRS Database).

Read `SPEC-let-sorted.md` for the product. This file is how the code works.

## Stack

- **Next.js 15** (App Router, Server Actions), TypeScript strict, **pnpm** workspace
- **Postgres 16** with plain SQL migrations. *Not* Supabase local: Docker is
  unavailable in this environment, so the spec's fallback applies. RLS policies
  live in the migrations. The data access layer is narrow enough that swapping
  back is one file.
- **Tailwind 4** plus a small in-house component set. No UI kit.
- **Vitest** for unit and database tests, **Playwright** for e2e
- **Zod** at every boundary

## Layout

```
packages/rules/     pure rule engine: no I/O, no clock reads, no database
apps/web/src/
  adapters/         live + mock pairs, chosen by env (see below)
  lib/              db access, auth, formatting, server-side helpers
  prompts/          versioned LLM prompt files
  app/              Next.js routes
db/migrations/      numbered .sql, applied in order, never edited once applied
scripts/            migrate, seed, demo, db setup
test/               database-backed tests (RLS, ledger)
```

## Commands

```bash
./scripts/setup-db.sh     # one-time: roles + databases (needs superuser)
pnpm db:migrate           # apply migrations
pnpm db:migrate --reset   # drop the schema and rebuild
pnpm demo                 # seed four personas and start with mocks on
pnpm dev                  # dev server on :3000
pnpm test                 # vitest (unit + database)
pnpm test:e2e             # playwright
pnpm ci                   # lint && typecheck && test && build
```

Postgres must be running: `pg_ctlcluster 16 main start`.

## Conventions that matter

**Money** is pennies as `bigint`, always. Never a float, never a Number for a
monetary value. One formatter renders it.

**Dates** are ISO `yyyy-MM-dd` calendar dates in Europe/London, held as strings.
The rule engine does arithmetic on calendar fields, never on `Date`, so a BST
transition cannot shift a deadline. Deadlines are inclusive end-of-day: on the
due date itself `days_remaining` is 0 and the landlord is still in time. Render
with `formatUkLong` ("14 March 2027").

**`today` is always a parameter.** The rule engine never reads the clock. This
is what makes time travel work and the tests deterministic.

**Soft deletes only.** Every table has `deleted_at`. Read through the `live_*`
views, never the base table, unless you specifically want deleted rows. RLS
deliberately does *not* filter `deleted_at` — see DECISIONS.md.

**Every database call that touches account data goes through `withAccount`**,
which sets the RLS context transaction-locally. Code that forgets gets zero rows
rather than everyone's rows: forgetting fails closed.

**Adapters** live in `src/adapters/<name>/` with `live.ts` and `mock.ts`. The
mock is deterministic and fixture-backed. With no keys configured the whole app
runs on mocks and says so in a dev banner. Never make a feature depend on a key
being present.

**Compliance content is data, not conditionals.** A rule is a row with sources,
a `checked_on` date and a verification status. If you cannot trace a statement
to a source URL it ships `unverified` and is hidden from users. Nothing in this
codebase may be marked `verified_primary` — that promotion is a human job.

## Hard limits

These are not style preferences. See `.claude/rules/security.md`.

- Never automate, script or scrape the GOV.UK registration service. Never ask
  for or store GOV.UK One Login credentials. We prepare; the landlord submits.
- Never present compliance content as legal advice. Never invent a requirement.
- Never let an LLM change stored compliance state without a human confirming it
  in the UI.
- No real email or SMS. Local mail catcher only.
- No deployments, no production services, no real secrets.
