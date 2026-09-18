# Questions for Joe

Nothing here blocked the build. Where a decision was needed I took the most
reversible option, recorded it in `DECISIONS.md`, and carried on. These are the
things that need a human.

---

## 1. Needs legal review before launch

**Nothing in the rule corpus is marked `verified_primary`, and a test enforces
that.** The most an automated build may assign is `verified_secondary`. Promotion
is a human job. Full list, with what specifically needs checking:

### PRS Database rules — currently `verified_secondary`

| Rule | What needs confirming against the made regulations |
|---|---|
| `PRS-REG-LANDLORD` | Whether the landlord entry deadline is the same date as the dwelling entry deadline. Exact treatment of joint landlords. |
| `PRS-REG-DWELLING` | The carve-outs: lodgers, high-rent lets (≥ £100k pa), low-rent lets, supported exempt accommodation. We have coded all four as out of scope. |
| `PRS-UPDATE-28D` | Whether the 28 days runs from the information becoming out of date or from the landlord becoming aware. We assumed the former, which is stricter. |
| `PRS-GAS-UPLOAD` | Whether the 28-day upload window runs from the certificate date or from the check. |
| `PRS-RENEW-ANNUAL` | That renewal synchronises to the anniversary of the landlord's **first** dwelling entry, not each property's own. The whole Renewal Planner depends on this. |
| `PRS-POSSESSION-BAR` | The precise scope of the bar and the Ground 7A / 14 exceptions. |
| `PRS-PENALTIES` | The £7,000 and £40,000 figures and exactly which breaches attract which. |

### Long-standing duties — currently `verified_secondary`

`GAS-ANNUAL`, `ELEC-5Y`, `ELEC-REMEDIAL-28D`, `EPC-VALID`, `ALARMS`,
`DEPOSIT-30D`, `RIGHT-TO-RENT`, `LICENSING`, `LEGIONELLA`, `ICO-FEE`.

These cite legislation.gov.uk and GOV.UK directly and I am reasonably confident
in them, but confident is not verified.

### Renters' Rights Act phase 1 — all `unverified`, hidden from users

Every one of these has a `TODO(verify)` and a placeholder parameter. They are
built as rule shells with working reminder hooks, so filling in a number is a
data change and not a build:

| Rule | Missing number |
|---|---|
| `RRA-RENT-INCREASE-LIMIT` | Annual limit and the statutory notice period. |
| `RRA-BIDDING-BAN` | Scope, and how it interacts with advertised rent ranges. |
| `RRA-RENT-IN-ADVANCE-CAP` | The cap, in months or weeks of rent. |
| `RRA-PET-REQUESTS` | The statutory response period. **28 days is a placeholder I invented for the shell — it is not sourced.** |
| `RRA-WRITTEN-STATEMENT` | Prescribed contents and the deadline for serving. |
| `RRA-INFO-SHEET` | The deadline for serving on pre-existing tenancies. |

### Proposed / future — `unverified`, informational only, no obligations

`EPC-C-PROPOSED`, `FUTURE-OMBUDSMAN`, `FUTURE-DECENT-HOMES`, `FUTURE-AWAABS-LAW`.

---

## 2. Facts I could not verify

- **The regional timetable itself.** The nine commencement and deadline dates
  come from the spec's reading of the draft regulations. They are stored as
  versioned data (`REGION_TIMETABLE_V1`) so a correction is a data edit, but
  every date in the product flows from this table and it is the single highest
  consequence thing to check.
- **The £65 fee.** Same: versioned in `FEE_SCHEDULE_V1`, sourced secondarily.
- **The EPC open data service endpoint.** The service has been migrating
  platforms. I wrote the live adapter against the `epc.opendatacommunities.org`
  API shape with HTTP basic auth, but could not confirm it is current. It runs
  mocked until someone confirms the endpoint and auth scheme.
- **Postcode → region mapping at boundaries.** The bundled fallback maps by
  postcode *area*, which is coarse. Areas that straddle a regional boundary are
  flagged `approximate` and the UI says so. The live postcodes.io path is exact;
  the fallback is for offline and outage. Worth a proper ONS lookup before
  launch if the Radar is the acquisition engine.
- **How the register treats per-room rents in an HMO.** Unresolved publicly. HMO
  mode models per-room tenancies rolling up to one dwelling entry, which is my
  best guess at the shape.

---

## 3. Design taste calls

- **Accent colour.** Bottle green (`#14532d`) is the default; oxblood
  (`#6b1d1d`) is implemented as an alternative — set `data-accent="oxblood"` on
  `<html>`. Both are in `tokens.css` and both are on the `/design` page in light
  and dark. Your call.
- **Typefaces.** Source Serif 4 for headings and figures, Source Sans 3 for UI,
  both from Google Fonts. Chosen for a civic, well-set feel with genuinely good
  tabular numerals, and because they load reliably. If you want something with
  more character for the serif, the swap is one line in `tokens.css` — but check
  the tabular figures, the countdowns depend on them.
- **The stamp.** Implemented as a rotated outline mark with a date. Currently on
  completed obligations only. Easy to overuse; I have kept it to one place.
- **18px base.** Larger than conventional. It is deliberate given the audience,
  but it makes dense screens taller, and the Rehearsal in particular gets long.

---

## 4. Commercial hypotheses, not findings

The plan prices in the spec (£6 / £15 / £49 per month) are implemented as stated
and stored as pennies in config. I have no evidence for them. The 14-day trial
and the per-property overage above 50 are likewise as specified.

---

## 5. Things you should look at with suspicion

- **The `app.bootstrap` flag** (D4 in `DECISIONS.md`). It is the one place the
  RLS model has a deliberate door in it. I have kept it to a handful of
  `SECURITY DEFINER` functions and it is transaction-local, but it is the thing
  I would most want a second pair of eyes on.
- **`exposurePennies`.** It sums the maximum penalty across breached rules. Even
  labelled "maximum theoretical", it is the most alarming number in the product
  and the furthest from the "calm over alarm" principle. It is off for anyone who
  picks calm mode. Consider whether it should exist at all.
- **The 28-day drift window** is computed from the moment a fact changes *in our
  app*, which is a proxy for when it changed in reality. If a landlord records a
  rent rise late, our clock starts late and theirs did not.
