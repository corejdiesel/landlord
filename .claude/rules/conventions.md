# Code conventions

## TypeScript

- `strict` plus `noUncheckedIndexedAccess`. Indexing an array gives you
  `T | undefined` — handle it or assert with `!` only where a preceding check
  makes it genuinely safe.
- Zod at every boundary: form input, route params, LLM output, adapter
  responses, webhook bodies. Parse, don't validate-and-hope.
- Prefer a discriminated union over a boolean pair. Prefer an exhaustive
  `switch` the compiler can check over an `if/else` chain.
- No `any`. `unknown` then narrow.

## Money and dates

- Money: pennies, `bigint`, always. `formatPennies` is the only renderer.
- Dates: ISO `yyyy-MM-dd` strings, Europe/London calendar dates. Use the helpers
  in `@letsorted/rules` — `addDays`, `addMonths`, `daysBetween`, `formatUkLong`.
  Do not reach for `Date` arithmetic or `date-fns` add/sub on a bare `Date`; that
  is how BST bugs get in.
- Any function that needs "now" takes `today: string` as a parameter.

## Database

- Read through `live_*` views. Base tables include soft-deleted rows.
- Every account-scoped query goes through `withAccount`.
- Migrations are numbered, append-only, and never edited once applied. If a
  policy is wrong, write a new migration that alters it and say why in the
  header comment.
- Every new table needs: `created_at`, `updated_at`, `deleted_at`, RLS enabled
  AND forced, a policy, a `live_*` view, and a test.

## Testing

- Every rule, every date calculation, and every RLS policy gets a test.
- Test names say what the behaviour is, not what the function is called:
  "is still in time on the deadline day itself", not "test dueOn".
- When a test fails, fix the code unless the test is provably asserting the
  wrong thing — and if it is, say so in the commit message.

## Comments

- Comment the *why*, not the *what*. A comment that restates the code is noise.
- Where a decision looks odd, the comment explains the alternative that was
  rejected and the reason. Several of the RLS policies are like this.
