-- 0006_bootstrap_select.sql — let the bootstrap functions read back what they wrote.
--
-- An INSERT ... RETURNING applies the table's SELECT policy to the new row, and
-- during signup there is no account context yet, so the read fails even though
-- the insert itself was allowed. Rather than dropping RETURNING (and losing the
-- ids the caller needs), the bootstrap flag gets a matching read path.
--
-- These are permissive policies, so they OR with the real ones. The flag is only
-- ever raised inside the bootstrap definer functions, and it is transaction-local.

create policy accounts_bootstrap_select on accounts for select
  using (app_is_bootstrapping());

create policy users_bootstrap_select on users for select
  using (app_is_bootstrapping());

create policy memberships_bootstrap_select on memberships for select
  using (app_is_bootstrapping());

create policy sessions_bootstrap_select on sessions for select
  using (app_is_bootstrapping());
