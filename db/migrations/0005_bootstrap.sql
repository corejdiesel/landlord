-- 0005_bootstrap.sql — let signup and login insert the rows they must.
--
-- The problem: `FORCE ROW LEVEL SECURITY` binds the table owner too, so a
-- SECURITY DEFINER function owned by the app role is still subject to every
-- policy. Signup has to insert an account before any account context can exist,
-- so it needs a way through.
--
-- The options, and why this one:
--   * Give the app role BYPASSRLS — it would then bypass RLS in the tests too,
--     so the suite would prove nothing.
--   * Add open INSERT policies on accounts/users — any signed-in session could
--     then mint rows; harmless-ish, but it states the wrong intent.
--   * This: a transaction-local flag that ONLY the bootstrap definer functions
--     set, and only for the statements that need it. It is never set by the
--     application layer, it cannot outlive its transaction, and the policies
--     below are the only ones that consult it.

create or replace function app_is_bootstrapping() returns boolean
  language sql stable as $fn$
    select coalesce(nullif(current_setting('app.bootstrap', true), ''), 'off') = 'on'
  $fn$;

create policy accounts_bootstrap_insert on accounts for insert
  with check (app_is_bootstrapping());

create policy users_bootstrap_insert on users for insert
  with check (app_is_bootstrapping());

create policy memberships_bootstrap_insert on memberships for insert
  with check (app_is_bootstrapping());

create policy sessions_bootstrap_insert on sessions for insert
  with check (app_is_bootstrapping());

create policy sessions_bootstrap_update on sessions for update
  using (app_is_bootstrapping()) with check (app_is_bootstrapping());

create policy users_bootstrap_update on users for update
  using (app_is_bootstrapping()) with check (app_is_bootstrapping());

-- Rewrite the bootstrap functions to raise and lower the flag around their own
-- inserts, so it is never left up for the rest of the transaction.

create or replace function app_signup(
  p_email text,
  p_name text,
  p_account_name text,
  p_account_type account_type default 'landlord'
) returns table (account_id uuid, user_id uuid)
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_account_id uuid;
    v_user_id uuid;
  begin
    if p_email is null or position('@' in p_email) = 0 then
      raise exception 'a valid email is required' using errcode = 'invalid_parameter_value';
    end if;

    perform set_config('app.bootstrap', 'on', true);

    if exists (select 1 from users where email = p_email::citext and deleted_at is null) then
      perform set_config('app.bootstrap', 'off', true);
      raise exception 'that email is already registered' using errcode = 'unique_violation';
    end if;

    insert into accounts (type, name) values (p_account_type, p_account_name)
      returning id into v_account_id;
    insert into users (email, name) values (p_email::citext, p_name)
      returning id into v_user_id;
    insert into memberships (account_id, user_id, role)
      values (v_account_id, v_user_id, 'owner');

    perform set_config('app.bootstrap', 'off', true);

    account_id := v_account_id;
    user_id := v_user_id;
    return next;
  end;
  $fn$;

create or replace function app_create_session(
  p_user_id uuid, p_token_hash text, p_expires_at timestamptz
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare v_id uuid;
  begin
    perform set_config('app.bootstrap', 'on', true);
    insert into sessions (user_id, token_hash, expires_at)
      values (p_user_id, p_token_hash, p_expires_at)
      returning id into v_id;
    perform set_config('app.bootstrap', 'off', true);
    return v_id;
  end;
  $fn$;

create or replace function app_destroy_session(p_token_hash text) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    update sessions set deleted_at = now(), expires_at = now()
      where token_hash = p_token_hash;
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

-- Look up a user for login. Definer, because login precedes any context.
create or replace function app_user_for_login(p_email text)
  returns table (id uuid, password_hash text, is_admin boolean)
  language sql stable security definer set search_path = public as $fn$
    select u.id, u.password_hash, u.is_admin
    from users u
    where u.email = p_email::citext and u.deleted_at is null
  $fn$;

create or replace function app_set_password(p_user_id uuid, p_hash text) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    update users set password_hash = p_hash, updated_at = now() where id = p_user_id;
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;
