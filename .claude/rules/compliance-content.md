# Compliance content rules

These exist because getting them wrong is the difference between a useful
product and a harmful one. They are not negotiable.

## Provenance

Every compliance statement shown to a user must carry:
- a source (a real URL, primary where possible),
- the date we last checked it (`checked_on`),
- whether it is in force, commencing, draft, proposed, or not commenced.

If you cannot trace a statement to a source, it ships with
`verification_status: "unverified"` and is feature-flagged away from end users.
Write it down in `QUESTIONS_FOR_JOE.md` under "Needs legal review before launch".

**Nothing in this codebase may be marked `verified_primary`.** The most an
automated build may assign is `verified_secondary`. Promotion to primary is a
human job after legal review.

## Never

- Never invent a legal requirement, a figure, a deadline or a penalty.
- Never present compliance content as legal advice.
- Never use a penalty figure as a call to action. The market is full of
  "£40,000 FINE!" marketing; we state exposure plainly, once, then show the path.
- Never let an LLM's output change stored compliance state. The model proposes;
  a human confirms in the UI; only then does anything become a fact.
- Never imply we submit anything to GOV.UK on the user's behalf.

## Voice

Second person. Short sentences. No Latin, no "shall", no jargon.

- "gas safety record", not "CP12" (mention CP12 once, as an alias)
- "electrical safety report", not "EICR" on first use
- "you need", not "the landlord is required to"
- Dates in long UK form: "14 March 2027"

Every screen that states a legal position carries the footer:
"General information, not legal advice. Sources and dates shown."

## Structure

Compliance logic is data. A rule is a row: id, version, predicate, obligation,
sources, status. It is never an `if` buried in a component. If you find yourself
writing a conditional about a legal requirement outside `packages/rules`, stop
and add a rule instead.
