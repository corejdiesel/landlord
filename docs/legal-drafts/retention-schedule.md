# Retention schedule — DRAFT, NOT LEGALLY REVIEWED

**Status: draft produced by an automated build. Not reviewed. Do not rely on it.**

The principle: keep what protects the landlord for as long as it could protect
them, and keep nothing else.

| Data | Kept for | Why | Status |
|---|---|---|---|
| Account and user record | Life of the account, then 30 days | Recovery from accidental deletion | `TODO(legal)` |
| Property and tenancy details | Life of the account + 6 years | Matches the period a council could ask about | `TODO(legal): confirm 6 years` |
| Compliance documents | 6 years from expiry | A superseded certificate still evidences the period it covered | `TODO(legal)` |
| Evidence Ledger | Life of the account + 6 years | It is the record. Append-only, so entries are never removed individually | `TODO(legal)` |
| Reminders sent | 6 years | Evidence the landlord was told | `TODO(legal)` |
| Pulse responses | Life of the tenancy | Only the current figure is needed; history may not be | `TODO(legal): decide whether to keep history` |
| Pulse request tokens | Until expiry, then 30 days | Debugging a failed link | `TODO(legal)` |
| Passport slugs | Until revoked, then 12 months | So a shared link can be explained | `TODO(legal)` |
| Attestation requests | 6 years | Evidence of what an agent asked and a landlord answered | `TODO(legal)` |
| Radar email captures | 24 months, or until unsubscribed | Marketing | `TODO(legal): confirm against PECR` |
| Inbound email raw copies | 90 days | Debugging a failed ingest | `TODO(legal)` |
| Server logs | 30 days | Operations | `TODO(legal)` |
| LLM call records | 12 months | Cost and quality review; no landlord personal data | `TODO(legal)` |

## Deletion

Soft deletes throughout (`deleted_at`), so deletion is recoverable within the
window above. Hard deletion on request is a separate flow.

**Not yet built:** the scheduled purge that enforces any of this. Everything is
currently kept. Listed in `HANDOVER.md`.

## The awkward one

The Evidence Ledger is append-only and hash-chained. Deleting a row would break
the chain and destroy the integrity guarantee for everything after it.

`TODO(legal): decide how a deletion request interacts with this. The likely
answer is to delete the whole chain for an account rather than rows within it,
but that needs a view on whether the chain is personal data of the landlord (very
likely) and what happens to an agent's copy of a shared attestation.`
