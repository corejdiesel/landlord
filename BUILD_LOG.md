# Build log

Append-only. One entry per phase: what was built, test results, what was skipped
and why, and the exact commands to run it.

---

## Phase 0 — Foundations

**Built**

- pnpm workspace: `packages/rules` (pure) + `apps/web` (Next.js 15, App Router,
  TypeScript strict with `noUncheckedIndexedAccess`).
- Postgres schema across seven migrations: accounts/users/memberships, landlord
  entities, properties (with joint ownership), tenancies (with an HMO per-room
  parent), registrations, register snapshots, drift items, documents, inbound
  emails, obligations, reminders, pulse requests/responses, passports, agent
  grants, attestation requests, Law Watch tables, subscriptions, radar signups,
  and the hash-chained ledger.
- RLS enabled **and forced** on every table, with `live_*` views for soft-delete
  filtering.
- `ledger_append` / `ledger_verify` as database functions, with an advisory lock
  so concurrent appends cannot fork the chain.
- Adapter layer with live+mock pairs: postcodes, epc, companiesHouse, llm, email,
  inboundEmail, payments, lawWatchFetcher, storage. Registry at
  `src/adapters/index.ts` decides live vs mock once.
- Design tokens, global stylesheet (including a real print stylesheet), the
  in-house component set, and the `/design` living style guide.
- `CLAUDE.md` and `.claude/rules/{conventions,compliance-content,security,design}.md`.

**Tests:** 257 passing.

```
packages/rules/test/dates.test.ts     42
packages/rules/test/engine.test.ts    66
packages/rules/test/radar.test.ts     49
apps/web/test/adapters.test.ts        48
test/rls.test.ts                      33
test/ledger.test.ts                   19
```

`pnpm typecheck` clean. `pnpm build` clean (3 routes prerendered).

**What is mocked, and why**

Everything except postcodes.io and the Law Watch fetcher, because no keys are
configured. This is the intended default — see D12. Specifically:

| Adapter | Mode | Why |
|---|---|---|
| postcodes | live | postcodes.io needs no key. Falls back to a bundled table on failure. |
| lawWatchFetcher | live | No key needed, but tests use recorded fixtures. |
| llm | mock | No `ANTHROPIC_API_KEY`. Deterministic fixture extraction. |
| epc | mock | No key, **and** the live endpoint needs confirming (see QUESTIONS 2). |
| companiesHouse | mock | No key. |
| payments | mock | Stripe test mode only; no live implementation in this build. |
| email | mock | Hard limit: no real mail. Writes to a local catcher. |
| inboundEmail | mock | No real MX exists. Local simulator only. |
| storage | mock | Local disk. No cloud bucket by design (no production services). |

**Skipped, and why**

- **Supabase local** — Docker unavailable in this environment. Fell back to plain
  Postgres per the spec. See D1.
- **`build/phase-N` branches** — the run's instructions designate a single branch.
  See D15.

**Bugs found by tests, and fixed**

1. Registration obligations read "not yet applicable" throughout the three-month
   window they exist to help with — applicability and due date were the same
   field. Fixed by separating them (D8).
2. A missing mandatory certificate read as "upcoming" rather than a breach (D9).
3. Soft deletion was impossible: the SELECT policy filtered `deleted_at`, and
   Postgres applies SELECT policies to the row an UPDATE produces (D3).
4. Storage path traversal was *sanitised* rather than refused, turning
   `../../etc/passwd` into a different unintended write (D14).

**How to run it**

```bash
pg_ctlcluster 16 main start      # Postgres must be up
./scripts/setup-db.sh            # one-time: roles and databases
pnpm install
pnpm db:migrate
pnpm dev                         # http://localhost:3000
pnpm test                        # 257 tests
pnpm ci                          # lint && typecheck && test && build
```

Time travel, essential for a product about deadlines:

```bash
TIME_TRAVEL_DATE=2027-03-01 pnpm dev   # thirteen days before the WM deadline
FORCE_MOCKS=1 pnpm dev                 # pin every adapter to its mock
```

---

## Phase 1 — Rule engine and timetable

**Built**

- `packages/rules`: pure, no I/O, no clock reads. `today` is always a parameter.
- Calendar-field date arithmetic (D7) with month-end and leap-day clamping, and
  explicit tests across both 2026 BST transitions.
- Data-defined predicates over an explicit fact bag, so a typo in a rule throws
  `UnknownFactError` rather than silently never applying.
- Seed corpus: 8 PRS rules, 10 long-standing duties, 6 Renters' Rights Act phase
  1 shells (all `unverified`), 4 proposed/informational.
- `REGION_TIMETABLE_V1` and `FEE_SCHEDULE_V1` as versioned data.
- Fixture library of landlord scenarios.

**Tests:** 157 in the package. Corpus-integrity tests enforce the constitutional
rules: nothing `verified_primary`, every rule sourced with a `checked_on` date,
every referenced fact actually exposed, every RRA rule unverified, every
`not_commenced`/`proposed` rule inert.

---

## Phase 2 — Deadline Radar

**Built**

- Public, no-login page at `/`. Postcode(s) in → region, commencement, deadline,
  days remaining, annual cost, and a one-line status.
- Accepts a pasted list in any format (commas, semicolons, newlines, runs of
  whitespace), capped at 25 per request.
- Multi-region portfolio timeline, ordered by deadline, surfacing the earliest —
  the one that actually bites.
- Honest about confidence: postcodes resolved from the bundled fallback rather
  than live are listed and labelled as approximate.
- Email capture, stored with the region so the list is segmentable from day one.
- Rejected postcodes are reported individually rather than failing the whole
  request.

**Tests:** covered by the radar suite in `packages/rules` (49) and the helper and
adapter tests in `apps/web` (48). End-to-end Playwright journey still to come in
the hardening phase.

**Not done yet:** OG image generation per result, and the SEO/Lighthouse pass.
Both are listed for Phase 12.
