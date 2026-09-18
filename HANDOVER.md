# Handover

Let Sorted — a compliance cockpit for private landlords in England under the
Renters' Rights Act 2025 and the "Register your rental property" service.

Built in one autonomous run from `SPEC-let-sorted.md`. This file is the honest
account: what works, what is simulated, what is unverified, and where the weak
spots are.

---

## The ten things to look at first

1. **`DECISIONS.md`** — sixteen decisions with the alternative rejected for each.
   If you disagree with one, that is the conversation worth having first.
2. **`QUESTIONS_FOR_JOE.md` section 1** — every rule and its verification status.
   Nothing is `verified_primary`; a test enforces that. This is the gate on launch.
3. **The regional timetable** (`packages/rules/src/data/timetable.ts`). Every
   date in the product flows from these eighteen numbers, and they are
   secondary-sourced. Highest consequence thing to check.
4. **`SECURITY.md` → T10, the bootstrap flag.** The one deliberate door in the
   RLS model. It is narrow and tested, but it shares the app role, and I would
   want a second pair of eyes on it.
5. **`packages/rules/src/engine.ts`** — the whole compliance model in one pure
   file. Read `deriveObligation`: each rule is handled explicitly rather than
   generically, on purpose.
6. **The Drift Clock** (`packages/rules/src/drift.ts`). The signature feature.
   Note that it diffs the snapshot of the *government's* entry, not our own
   previous state — the tests explain why that distinction matters.
7. **`/design`** — the style guide. Bottle green is the default accent; oxblood
   is implemented as the alternative. Your call, and it is a one-line change.
8. **`exposurePennies`** in the engine. The most alarming number in the product
   and the furthest from "calm over alarm". It is off in calm mode. Consider
   whether it should exist at all.
9. **`test/e2e/journey.spec.ts`** — the definition-of-done journey as one test.
   The fastest way to see the whole product working.
10. **The "Known gaps" table at the end of `SECURITY.md`**, and "Not built"
    below. Both are deliberately blunt.

---

## How to run it

```bash
pg_ctlcluster 16 main start      # Postgres 16 must be running
./scripts/setup-db.sh            # one-time: roles and databases (needs superuser)
pnpm install
pnpm db:migrate
pnpm demo                        # reset, seed four personas, start on :3000
```

`pnpm demo` is the one command that matters: it produces a fully navigable
product with **no keys configured at all**.

Sign in as any persona, password `demo-password-123`:

| Email | What it exercises |
|---|---|
| `sylvia@example.test` | One London flat, everything in order. The calm baseline. |
| `ade@example.test` | Joint owners, two regions, a lapsed gas certificate, missing prescribed information. |
| `ops@brightside.test` | Company landlord, licensed HMO, unsatisfactory EICR, a registered property with an open drift item. |
| `hello@kerrandco.test` | Letting agent with three client landlords. Also the admin, for Law Watch. |

Other commands:

```bash
pnpm check           # lint && typecheck && test && build — all green
pnpm test            # 459 unit and database tests
pnpm test:e2e        # 8 Playwright tests (see the note on Chromium below)
pnpm dev             # dev server
TIME_TRAVEL_DATE=2027-03-01 pnpm dev    # thirteen days before the WM deadline
FORCE_MOCKS=1 pnpm dev                  # pin every adapter to its mock
```

**Time travel** is essential for a product about deadlines. In a production
build it also needs `ALLOW_TIME_TRAVEL=1`, deliberately — see DECISIONS.

**Playwright** needs `CHROMIUM_PATH` in this environment, because the pinned
version expects a browser revision that is not installed:

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test:e2e
```

---

## What is built

Everything in the spec's protected order (1 → 2 → 5 → 6 → 4 → 7), and then the
rest.

**Rule engine** (`packages/rules`) — pure, no I/O, no clock reads. Data-defined
predicates, versioned rules with sources and `checked_on` dates, regional
timetable and fee schedule as versioned data. 28 rules.

**Deadline Radar** — public, no login. Postcodes in, dates out, multi-region
portfolio timeline, honest about when it used the bundled fallback rather than a
live lookup. Email capture segmented by region.

**Registration Rehearsal and Pack** — the government's questions in the
government's order, prefilled, each with a copy button, readiness score with
blockers that say what to do. Prints to A4.

**Cert Inbox** — upload or forward, model extraction with per-field confidence,
side-by-side confirm. Nothing counts until a human confirms it.

**Drift Clock** — 28-day windows from a snapshot of the government entry,
escalating reminders, per-item confirmation.

**Renewal Planner** — synchronised to the anniversary of the first dwelling
entry, with reminders at 30/14/7/1 days.

**Evidence Ledger and Defence File** — append-only, hash-chained, tamper-evident,
exportable as a printable record with a verification page.

**Possession Readiness** — a checklist, with tests that keep it one.

**Household Pulse** — two integers, nothing else, enforced by a test that reads
`information_schema`.

**Tenant Passport** — allowlist rendering, street-only location, revocable.

**Agent workspace and Attestation** — grants created only by the landlord,
answers written to both parties' ledgers.

**Law Watch** — source diffing, model-drafted summaries, admin review queue that
never edits a rule.

**Plans** — one capability map, overage pricing, Stripe test mode only.

---

## What is simulated

With no keys configured, nine adapters run mocked and the UI says so in a banner.

| Adapter | Mode | Note |
|---|---|---|
| postcodes | **live** | postcodes.io needs no key. Falls back to a bundled table on failure. |
| lawWatchFetcher | **live** | No key needed. Tests use fixtures. |
| llm | mock | Deterministic, seeded from the input. Real prompts are written and versioned. |
| epc | mock | Live adapter written; the endpoint needs confirming (QUESTIONS §2). |
| companiesHouse | mock | Live adapter written, needs a key. |
| payments | mock | Stripe test mode only; no live implementation. |
| email | mock | Hard limit: no real mail. Writes to `.mail/`. |
| inboundEmail | mock | No MX. The simulator runs the identical ingest path. |
| storage | mock | Local disk, with real signed-URL verification. |

---

## What is unverified

**Every compliance rule.** Nothing is `verified_primary`, enforced by a test.
Renters' Rights Act phase 1 rules are `unverified` and hidden from users, with
`TODO(verify)` on each missing number — including a 28-day pet-request response
period that I invented as a placeholder and which is **not sourced**.

Full list in `QUESTIONS_FOR_JOE.md` §1.

---

## Not built

Honest list. None of it is hidden behind a stub that pretends otherwise.

- **Rate limiting** on public endpoints. Needed before launch.
- **Co-owner invite links.** The Pack explains joint ownership and the data model
  supports it; the invite flow itself is not built.
- **CSV import**, **HMO per-room mode**, **grounded assistant**, **bedroom
  counter**, **EPC autofill UI**, **engineer nudge** — the spec's stretch items.
  Capability flags exist for the first two.
- **OG image generation** for Radar results, and the SEO/Lighthouse pass.
- **The retention purge job.** The schedule is drafted; nothing enforces it.
- **Account export and deletion flows.** The ledger's interaction with a deletion
  request is an open question (see `retention-schedule.md`).
- **Stripe checkout.** Plan gating works; there is no live billing.
- **MFA.**
- **Screenshots** in `/docs/screens/`. The e2e run captures on failure only.

---

## Weak spots

The things I would look at hardest.

1. **The bootstrap flag shares the app role.** A caller who can already run
   arbitrary SQL as the app role can set it at session scope and read across
   accounts. The protection is that nothing in the application does. Fixing it
   properly means a separate role for the definer functions.

2. **`SECURITY DEFINER` does not escape `FORCE ROW LEVEL SECURITY`, and I got
   that wrong four times.** Sign-in, inbound routing, the passport and the pulse
   lookup each shipped silently returning zero rows. There is now an invariant
   test over `pg_proc`, itself tested against a synthetic bad definition, but the
   pattern is a genuine trap for anyone adding a public surface.

3. **Address matching in the Cert Inbox** returns null rather than guessing, and
   the scoring is a hand-rolled token overlap. It is deliberately conservative,
   but it is the crudest algorithm in the codebase.

4. **The drift window starts when a fact changes in our app**, which is a proxy
   for when it changed in reality. A landlord who records a rent rise late starts
   our clock late and the real one has already been running.

5. **The postcode fallback maps by postcode area**, which is coarse. Boundary
   areas are flagged approximate and the UI says so, but if the Radar is the
   acquisition engine it deserves a proper ONS lookup.

6. **No load testing, no performance work.** The dashboard evaluates every
   property on every request, which is fine for ten properties and not for an
   agent with fifty. The materialised `obligations` table exists for this and is
   written but not yet read.

7. **The mock LLM is convincing enough to mislead.** It produces plausible
   extractions deterministically, so a demo looks like the real thing. Anyone
   evaluating extraction quality must set a real key.

---

## Deviations from the spec

- **Plain Postgres instead of Supabase local** — Docker is unavailable here, and
  the spec names this fallback. (DECISIONS D1.)
- **One branch instead of `build/phase-N` branches** — the run's instructions
  designate a single branch. Commit granularity still follows the spec. (D15.)
- **`pnpm check` rather than `pnpm ci`** — `ci` collides with a pnpm built-in.
