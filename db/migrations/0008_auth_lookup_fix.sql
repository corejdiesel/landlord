-- 0008_auth_lookup_fix.sql — the login and session lookups could never return a row.
--
-- `app_user_for_login` and `app_session_context` are SECURITY DEFINER, which was
-- assumed to be enough. It is not: FORCE ROW LEVEL SECURITY binds the table
-- owner, so a definer function owned by the app role is still filtered by every
-- policy. Both functions read `users`, `sessions` and `memberships` before any
-- account context exists — that is precisely what they establish — so the
-- policies matched nothing and both silently returned zero rows.
--
-- Silently is the problem: sign-in reported "that email and password do not
-- match" for a correct password, and a valid session cookie resolved to signed
-- out. Caught by trying to sign in as a seeded persona.
--
-- Fix: raise the same transaction-local bootstrap flag the other pre-context
-- functions use (see 0005), around the read and no wider.

create or replace function app_user_for_login(p_email text)
  returns table (id uuid, password_hash text, is_admin boolean)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    return query
      select u.id, u.password_hash, u.is_admin
      from users u
      where u.email = p_email::citext and u.deleted_at is null;
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

create or replace function app_session_context(p_token_hash text)
  returns table (user_id uuid, account_id uuid, is_admin boolean, role membership_role)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    return query
      select u.id, m.account_id, u.is_admin, m.role
      from sessions s
      join users u on u.id = s.user_id
      join memberships m on m.user_id = u.id and m.deleted_at is null
      where s.token_hash = p_token_hash
        and s.expires_at > now()
        and s.deleted_at is null
        and u.deleted_at is null
      order by m.created_at asc
      limit 1;
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;
