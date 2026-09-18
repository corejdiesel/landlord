# Data Protection Impact Assessment — OUTLINE ONLY

**Status: a skeleton produced by an automated build. This is not an assessment.
It marks out what an assessment would have to cover.**

## Is a DPIA required?

Probably yes. `TODO(legal): confirm against the ICO's screening checklist.`
Arguments that it is: we process data about identifiable tenants' living
arrangements (indirectly), we process on a novel combination of sources, and the
service exists to support a legal obligation with penalties attached.

## 1. The processing

**What:** a compliance record for private landlords in England — properties,
lettings, certificates, registration status, and an append-only log of what was
done and when.

**Scale:** `TODO: fill in at launch.` Market is ~2.8m private landlords in
England; realistic early scale is much smaller.

**Nature:** mostly landlord-provided. Two flows deserve attention:
- Occupancy data collected from tenants through a no-login link.
- Documents read by a vision model to extract dates and outcomes.

## 2. Necessity and proportionality

`TODO(legal): complete.` Starting points:
- The occupancy figures are required by the register; the alternative is the
  landlord guessing, which is worse for everyone.
- We collect two integers rather than any identifying information, which is the
  minimum that answers the question.
- The Tenant Passport publishes only what the landlord chooses, from an
  allowlist, and never the landlord's address.

## 3. Risks

| Risk | Likelihood | Severity | Mitigation | Residual |
|---|---|---|---|---|
| One account reads another's data | Low | High | RLS forced on every table, tested | `TODO` |
| A passport leaks a landlord's address | Low | High | Allowlist rendering, street-only location, tested | `TODO` |
| A pulse link is forwarded and answered by a stranger | Medium | Low | Only two integers at stake; single use; expiring | `TODO` |
| An agent retains access after a landlord ends the relationship | Low | Medium | Grants are revocable, revocation is immediate | `TODO` |
| A model misreads a certificate and the landlord believes it | Medium | High | Nothing counts until a human confirms; prompt returns null rather than guessing; confidence surfaced | `TODO` |
| A reminder is not delivered and a deadline is missed | Medium | High | Email + in-app + ICS redundancy; every send ledgered | `TODO` |
| The compliance record is altered | Low | High | Append-only, hash-chained, verifiable | `TODO` |
| A tenant is identified from occupancy data | Low | Medium | No identifying data collected | `TODO` |

## 4. Consultation

`TODO: consult actual landlords and tenants. The residual risk ratings above are
guesses until someone outside the build has looked at them. Speaking to a
tenant advocacy organisation about the Pulse and the Passport would be worth
more than any amount of internal review.`

## 5. Sign-off

`TODO(legal): DPO or equivalent, with a date.`
