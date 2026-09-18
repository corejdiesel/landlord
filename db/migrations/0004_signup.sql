-- 0004_signup.sql — account creation, which necessarily precedes RLS context.
--
-- `accounts` and `users` deliberately have no INSERT policy: with FORCE ROW
-- LEVEL SECURITY there is no way to insert them from an ordinary session, which
-- is what we want. Signup is the one legitimate exception, so it goes through a
-- SECURITY DEFINER function with a narrow, explicit contract instead of a broad
-- policy that would also let a signed-in account mint others.

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

    select id into v_user_id from users where email = p_email::citext and deleted_at is null;
    if v_user_id is not null then
      raise exception 'that email is already registered' using errcode = 'unique_violation';
    end if;

    insert into accounts (type, name) values (p_account_type, p_account_name)
      returning id into v_account_id;
    insert into users (email, name) values (p_email::citext, p_name)
      returning id into v_user_id;
    insert into memberships (account_id, user_id, role)
      values (v_account_id, v_user_id, 'owner');

    account_id := v_account_id;
    user_id := v_user_id;
    return next;
  end;
  $fn$;

/**
 * Resolve a session cookie to its account context.
 *
 * Runs before any RLS context exists (that is what it establishes), so it is a
 * definer function returning only the ids and flags the app needs. It takes the
 * token HASH: the raw cookie value never reaches the database.
 */
create or replace function app_session_context(p_token_hash text)
  returns table (user_id uuid, account_id uuid, is_admin boolean, role membership_role)
  language sql stable security definer set search_path = public as $fn$
    select u.id, m.account_id, u.is_admin, m.role
    from sessions s
    join users u on u.id = s.user_id
    join memberships m on m.user_id = u.id and m.deleted_at is null
    where s.token_hash = p_token_hash
      and s.expires_at > now()
      and s.deleted_at is null
      and u.deleted_at is null
    order by m.created_at asc
    limit 1
  $fn$;

create or replace function app_create_session(
  p_user_id uuid, p_token_hash text, p_expires_at timestamptz
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare v_id uuid;
  begin
    insert into sessions (user_id, token_hash, expires_at)
      values (p_user_id, p_token_hash, p_expires_at)
      returning id into v_id;
    return v_id;
  end;
  $fn$;

create or replace function app_destroy_session(p_token_hash text) returns void
  language sql security definer set search_path = public as $fn$
    update sessions set deleted_at = now(), expires_at = now()
    where token_hash = p_token_hash
  $fn$;
