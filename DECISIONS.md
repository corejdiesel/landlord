# Decisions

Every non-obvious choice, with the alternative that was rejected.

---

## D1 — Plain Postgres instead of Supabase local

**Chosen:** Postgres 16 with plain SQL migrations, a thin `pg`-based data access
layer, and hand-rolled session auth.

**Rejected:** Supabase CLI local stack (the spec's first preference).

**Why:** Docker is not available in this environment — `/var/run/docker.sock`
does not exist — so the Supabase local stack cannot start. The spec anticipates
exactly this and names the fallback. RLS policies live in the migrations, as the
spec requires, and the data access layer is narrow (`withAccount`,
`withoutAccount`, `queryAs`) so swapping to Supabase later is one file.

**Cost:** Auth, storage and realtime are hand-rolled rather than provided. Auth
is simple session cookies; storage is local disk behind the same adapter
interface a bucket would use.

---

## D2 — `FORCE ROW LEVEL SECURITY`, and the app role is not a superuser

**Chosen:** Every table has RLS *enabled and forced*. The application role
`letsorted` is `NOSUPERUSER` and does not have `BYPASSRLS`. A test asserts both.

**Rejected:** Plain `ENABLE ROW LEVEL SECURITY`, which the table owner bypasses.

**Why:** The app role owns these tables. Without `FORCE`, every policy would be
inert for the very connection the application uses, and the whole RLS test suite
would pass while proving nothing. This is the single most load-bearing line in
the schema.

---

## D3 — RLS enforces tenancy isolation only; soft-delete filtering moved out

**Chosen:** SELECT policies test "does this account own the row?" and nothing
else. A `live_*` view per table adds `where deleted_at is null`, and the data
access layer reads through those views.

**Rejected:** SELECT policies that also filtered `deleted_at is null` (the
original design).

**Why:** Found by a failing test. PostgreSQL applies a table's SELECT policy to
the row an UPDATE produces, so `update properties set deleted_at = now()`
produced a row its own SELECT policy rejected — making soft deletion, the
schema's only delete mechanism, impossible. Beyond the bug, the original policy
was doing two jobs: "whose row is this" is a security boundary, "is this row
still live" is a business rule. Separating them fixed the bug and made both
clearer.

---

## D4 — A transaction-local bootstrap flag for signup and public writes

**Chosen:** `app_signup`, session handling, the public passport/pulse lookups and
the radar capture are `SECURITY DEFINER` functions that raise a transaction-local
`app.bootstrap` flag around their own statements. Narrow policies consult that
flag. Application code never sets it.

**Rejected, and why:**
- *Grant the app role `BYPASSRLS`.* It would then bypass RLS in the test suite
  too, so D2's guarantee would evaporate.
- *Open INSERT policies on `accounts` and `users`.* Any signed-in session could
  then mint rows. Not catastrophic (they could not grant themselves membership),
  but it states the wrong intent and invites worse later.
- *Drop `RETURNING` from the definer functions.* Loses the ids the caller needs,
  and the read-back would still fail for the same reason.

**Cost:** One more concept to understand. Mitigated by keeping the flag's use to
a handful of functions, all in one migration, all commented.

---

## D5 — Ledger chain computed in the database, not the application

**Chosen:** `ledger_append(account_id, type, payload)` allocates `seq` and
computes the hash chain inside a function that takes a per-account advisory lock.

**Rejected:** Reading the chain tip in the app, computing the hash there, and
inserting.

**Why:** Two concurrent appends would read the same tip and write a forked chain,
and the fork would only be discovered later during verification — by which point
the evidence is already worthless. A test appends from five separate connections
simultaneously and asserts the sequence is exactly 1..5 with an intact chain.

The genesis row's `prev_hash` is `sha256(account_id)` rather than a constant, so
a chain cannot be lifted from one account and replayed under another.

---

## D6 — Ledger immutability enforced twice, and tested separately

**Chosen:** `ledger_events` has no UPDATE or DELETE policy (so an ordinary
statement matches zero rows) *and* triggers that reject the operation outright
(so anyone past RLS is still refused). Tests assert each independently.

**Why:** The two defences fail differently — RLS silently no-ops, triggers raise.
A test that only checked "the row did not change" would pass even if the triggers
were deleted. Tamper-detection tests run over a dedicated `BYPASSRLS` connection,
because the hash chain exists precisely for the attacker who got past everything
else, and a test that cannot reach the rows cannot prove the chain works.

---

## D7 — Calendar-field date arithmetic, not `Date`

**Chosen:** Dates are ISO `yyyy-MM-dd` strings. Arithmetic converts to an epoch
*day* number via civil-calendar maths and back. `Date` appears only in
`londonDateOf`, which turns a real instant into a London calendar date.

**Rejected:** `date-fns` `addDays`/`differenceInDays` over `Date` objects.

**Why:** A deadline is a calendar date, not an instant. Doing arithmetic on
`Date` means every operation carries a time and a zone, and BST transitions
(29 March and 25 October 2026 both fall inside the rollout window) produce
off-by-one-day deadlines. Tests cover both transitions explicitly.

Deadlines are inclusive end-of-day: on the due date `days_remaining` is 0 and the
landlord is still in time. Getting this backwards would have the product telling
people they had missed a deadline they had not.

---

## D8 — Applicability date and due date are different things

**Chosen:** A PRS rule's duty begins at the region's *commencement* date and
falls due at the region's *deadline*. `resolveAppliesFrom` and the due-date
anchor are computed separately.

**Rejected:** One `effective_from` serving both (the original implementation).

**Why:** Found by a failing test. With one date, a West Midlands registration
obligation read "not yet applicable" on 1 March 2027 — thirteen days before its
deadline, in the middle of exactly the window the product exists to help with.

---

## D9 — A missing mandatory certificate is a breach today, not "upcoming"

**Chosen:** `deriveObligation` returns an `inBreachNow` flag; a let property with
gas and no gas safety record on file reads **overdue**.

**Rejected:** Deriving state purely from a due date, which left "no document at
all" with a null due date and therefore the reassuring state "upcoming".

**Why:** Also found by a failing test. The reassuring answer was the wrong one:
a landlord with no certificate is in breach now, and the product's whole job is
to say so plainly rather than comfortingly.

---

## D10 — Unverified rules are excluded by default, not included with a warning

**Chosen:** `evaluate()` drops `unverified` rules unless `includeUnverified` is
passed. Every Renters' Rights Act phase 1 rule ships unverified.

**Rejected:** Showing them with a badge.

**Why:** The spec's hard limit. An unverified rule is one whose *numbers* we
could not source — the notice period, the cap, the response window. A reminder
built on a guessed statutory period is worse than no reminder, because the
landlord will trust it. The rule shells, IDs and UI exist so a human filling in
the numbers is a data change, not a build.

---

## D11 — Nothing is marked `verified_primary`

**Chosen:** The corpus caps at `verified_secondary`. A test enforces it.

**Why:** Spec 6.1. Primary verification means someone read the legislation and
staked their professional judgement on it. An automated build cannot do that, and
a test is the only way to stop it drifting in later by accident.

---

## D12 — Mock adapters are the default, and a missing key is never an error

**Chosen:** `adapterModes()` picks live or mock per adapter from the environment.
No key means mock, the UI says which services are simulated, and `FORCE_MOCKS=1`
pins everything to mock even with keys present.

**Rejected:** Throwing on a missing key, or branching on key presence at each
call site.

**Why:** `pnpm demo` has to produce a fully navigable product with nothing
configured. If a feature could branch on whether a key exists, that guarantee
would erode one feature at a time. Mocks are deterministic — seeded from the
input, never random — so demos and tests are reproducible.

---

## D13 — The document extraction prompt must return `null`, not a guess

**Chosen:** The prompt's first and most emphatic instruction is to return `null`
for anything not clearly readable, with confidence 0.

**Why:** A confidently wrong expiry date on a gas safety record would mark a
landlord compliant when they are not, and they would find out from an enforcement
officer. "I could not read it" costs a few seconds of human attention; a wrong
date costs up to £7,000 and a possession claim.

---

## D14 — Storage keys that escape the root are refused, not sanitised

**Chosen:** `safePath` resolves the key and rejects anything outside the storage
root.

**Rejected:** Stripping leading `../` segments and continuing (the original
implementation, caught by a test).

**Why:** Sanitising turned `../../etc/passwd` into a write to
`<root>/etc/passwd` — a traversal attempt quietly converted into a *different*
unintended write. Refusing surfaces the caller's bug instead of hiding it.

---

## D15 — One branch, not `build/phase-N` branches

**Chosen:** All work on `claude/lucid-gates-pbc4cx`, committed per green test run.

**Rejected:** The spec's `build/phase-N` branch per phase, merged to `main`.

**Why:** The run's operating instructions designate a single branch and say not
to push elsewhere without explicit permission. That instruction is more specific
and more recent than the spec's suggestion, so it wins. Commit granularity still
follows the spec — one commit per green test run, conventional messages, no
force-pushes, no rewritten history.

---

## D16 — Pricing figures are hypotheses

The plan prices (£6 / £15 / £49 per month) are recorded as stated in the spec and
stored in config as pennies. They are untested hypotheses, not researched
positions, and are flagged as such in `QUESTIONS_FOR_JOE.md`.
