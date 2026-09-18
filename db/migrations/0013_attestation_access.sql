-- 0013_attestation_access.sql — views and access paths the attestation flow needs.
--
-- Two gaps, both found by tests:
--
-- 1. `attestation_requests`, `agent_grants` and the law_watch tables never got
--    live_* views, so any query following the project convention of reading
--    through a view failed with "relation does not exist".
--
-- 2. A landlord answers an attestation from an emailed link, with no account and
--    no session — that is the point of the feature, since putting a signup in
--    front of a ten-second question defeats it. So the read, the state change
--    and the two ledger appends all happen with no account context and need
--    bootstrap-gated paths, like the other public surfaces.
--
-- The ledger insert path is the one to look at hardest: it is the only place
-- anything may be appended to a chain without an account context. It is scoped
-- to the bootstrap flag, which only the definer functions and this flow raise,
-- and the append itself still goes through ledger_append, so the hash chain and
-- the advisory lock apply exactly as they always do.

create view live_attestation_requests as
  select * from attestation_requests where deleted_at is null;

create view live_agent_grants as
  select * from agent_grants where deleted_at is null and revoked_at is null;

create view live_law_watch_sources as
  select * from law_watch_sources where deleted_at is null;

create view live_law_watch_changes as
  select * from law_watch_changes where deleted_at is null;

create policy attestation_bootstrap_select on attestation_requests for select
  using (app_is_bootstrapping());

create policy attestation_bootstrap_update on attestation_requests for update
  using (app_is_bootstrapping()) with check (app_is_bootstrapping());

create policy ledger_bootstrap_insert on ledger_events for insert
  with check (app_is_bootstrapping());

create policy ledger_bootstrap_select on ledger_events for select
  using (app_is_bootstrapping());
