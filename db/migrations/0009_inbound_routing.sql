-- 0009_inbound_routing.sql — resolve an inbound email address to an account.
--
-- Inbound mail arrives with no session, so this is another pre-context read and
-- follows the same pattern as the auth lookups: SECURITY DEFINER plus the
-- transaction-local bootstrap flag, because DEFINER alone does not escape
-- FORCE ROW LEVEL SECURITY (see 0008).
--
-- It returns the account's OWNER user, because an ingested document has to be
-- attributed to somebody and inbound mail cannot prove who sent it. Anything
-- arriving this way is unconfirmed until a human confirms it in the UI.

create or replace function app_account_for_inbound_token(p_token text)
  returns table (account_id uuid, user_id uuid)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    return query
      select a.id, m.user_id
      from accounts a
      join memberships m on m.account_id = a.id and m.role = 'owner' and m.deleted_at is null
      where a.inbound_token = p_token and a.deleted_at is null
      order by m.created_at asc
      limit 1;
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

-- accounts needs a bootstrap read path for the lookup above.
create policy accounts_bootstrap_read on accounts for select
  using (app_is_bootstrapping());
