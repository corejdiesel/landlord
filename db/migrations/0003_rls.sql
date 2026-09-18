-- 0003_rls.sql — row level security on every table.
--
-- Model:
--   * Almost every table carries account_id and is visible only to the current
--     account, OR to an agent holding a live grant over that account.
--   * FORCE ROW LEVEL SECURITY is set so the table owner is not exempt. Without
--     it, the app role owning these tables would bypass every policy below and
--     the tests would pass while proving nothing.
--   * ledger_events gets SELECT and INSERT only. No update, no delete.
--   * Public surfaces (passports, pulse links, attestations) are reached by
--     unguessable token through SECURITY DEFINER functions, never by opening
--     the tables to anonymous select.

-- An agent account may read a landlord account's rows only while an
-- unrevoked grant exists.
create or replace function app_can_access_account(target uuid) returns boolean
  language sql stable as $fn$
    select
      target = app_current_account_id()
      or exists (
        select 1 from agent_grants g
        where g.agent_account_id = app_current_account_id()
          and g.landlord_account_id = target
          and g.revoked_at is null
          and g.deleted_at is null
      )
  $fn$;

-- Apply the standard account-scoped policy to every table that has account_id.
do $do$
declare
  t text;
  account_scoped text[] := array[
    'accounts', 'memberships', 'landlord_entities', 'properties',
    'property_landlords', 'tenancies', 'registrations', 'register_snapshots',
    'drift_items', 'documents', 'inbound_emails', 'obligations', 'reminders',
    'pulse_requests', 'pulse_responses', 'passports', 'subscriptions'
  ];
begin
  foreach t in array account_scoped loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);

    if t = 'accounts' then
      execute format($p$
        create policy %1$s_select on %1$I for select
          using (app_can_access_account(id) and deleted_at is null)
      $p$, t);
      execute format($p$
        create policy %1$s_modify on %1$I for update
          using (id = app_current_account_id())
          with check (id = app_current_account_id())
      $p$, t);
    else
      -- Read: own account, or an agent with a live grant.
      execute format($p$
        create policy %1$s_select on %1$I for select
          using (app_can_access_account(account_id) and deleted_at is null)
      $p$, t);
      -- Write: an agent may prepare data for a granted landlord, which is the
      -- whole point of the agent tier; the landlord attests to it separately.
      execute format($p$
        create policy %1$s_insert on %1$I for insert
          with check (app_can_access_account(account_id))
      $p$, t);
      execute format($p$
        create policy %1$s_update on %1$I for update
          using (app_can_access_account(account_id))
          with check (app_can_access_account(account_id))
      $p$, t);
      -- No DELETE policy anywhere: deletes are soft, via deleted_at.
    end if;
  end loop;
end;
$do$;

-- users: a user sees themselves, and fellow members of their current account.
alter table users enable row level security;
alter table users force row level security;
create policy users_select on users for select
  using (
    deleted_at is null
    and (
      id = app_current_user_id()
      or exists (
        select 1 from memberships m
        where m.user_id = users.id
          and m.account_id = app_current_account_id()
          and m.deleted_at is null
      )
    )
  );
create policy users_update on users for update
  using (id = app_current_user_id())
  with check (id = app_current_user_id());

-- sessions: only ever touched by the auth layer, scoped to the session's user.
alter table sessions enable row level security;
alter table sessions force row level security;
create policy sessions_all on sessions for all
  using (user_id = app_current_user_id())
  with check (user_id = app_current_user_id());

-- agent_grants: visible to both sides of the grant. Only the landlord can
-- create or revoke one -- an agent must never be able to grant itself access.
alter table agent_grants enable row level security;
alter table agent_grants force row level security;
create policy agent_grants_select on agent_grants for select
  using (
    deleted_at is null
    and (agent_account_id = app_current_account_id()
      or landlord_account_id = app_current_account_id())
  );
create policy agent_grants_insert on agent_grants for insert
  with check (landlord_account_id = app_current_account_id());
create policy agent_grants_update on agent_grants for update
  using (landlord_account_id = app_current_account_id())
  with check (landlord_account_id = app_current_account_id());

-- attestation_requests: both parties read; the agent raises them.
alter table attestation_requests enable row level security;
alter table attestation_requests force row level security;
create policy attestation_select on attestation_requests for select
  using (
    deleted_at is null
    and (agent_account_id = app_current_account_id()
      or landlord_account_id = app_current_account_id())
  );
create policy attestation_insert on attestation_requests for insert
  with check (agent_account_id = app_current_account_id());
create policy attestation_update on attestation_requests for update
  using (
    agent_account_id = app_current_account_id()
    or landlord_account_id = app_current_account_id()
  )
  with check (
    agent_account_id = app_current_account_id()
    or landlord_account_id = app_current_account_id()
  );

-- Law Watch is operator data. Any signed-in user may read the approved feed;
-- only an admin may see pending items or change anything.
alter table law_watch_sources enable row level security;
alter table law_watch_sources force row level security;
create policy law_sources_select on law_watch_sources for select
  using (deleted_at is null);
create policy law_sources_write on law_watch_sources for all
  using (app_is_admin()) with check (app_is_admin());

alter table law_watch_snapshots enable row level security;
alter table law_watch_snapshots force row level security;
create policy law_snapshots_admin on law_watch_snapshots for all
  using (app_is_admin()) with check (app_is_admin());

alter table law_watch_changes enable row level security;
alter table law_watch_changes force row level security;
-- Users see only what an admin has approved and published.
create policy law_changes_select on law_watch_changes for select
  using (deleted_at is null and (app_is_admin() or (review_state = 'approved' and published_at is not null)));
create policy law_changes_write on law_watch_changes for all
  using (app_is_admin()) with check (app_is_admin());

-- radar_signups: written by the public radar page via a definer function,
-- readable only by admins. No account context exists at capture time.
alter table radar_signups enable row level security;
alter table radar_signups force row level security;
create policy radar_signups_admin on radar_signups for all
  using (app_is_admin()) with check (app_is_admin());

-- ledger_events: read your own account's chain; append only.
alter table ledger_events enable row level security;
alter table ledger_events force row level security;
create policy ledger_select on ledger_events for select
  using (app_can_access_account(account_id));
create policy ledger_insert on ledger_events for insert
  with check (account_id = app_current_account_id());
-- Deliberately no UPDATE or DELETE policy: with RLS forced and no policy,
-- those commands affect zero rows even before the triggers fire.

-- ---------------------------------------------------------------------------
-- Token-reached public surfaces
--
-- These run as SECURITY DEFINER so an anonymous visitor with a valid token can
-- read exactly the fields the landlord chose to publish, without any table
-- being readable anonymously. Each one takes a token HASH, so the raw token
-- never reaches the database.
-- ---------------------------------------------------------------------------

create or replace function public_passport(p_slug text)
  returns table (
    property_id uuid,
    line1 text,
    town text,
    postcode text,
    visibility jsonb,
    expires_at timestamptz
  )
  language sql stable security definer set search_path = public as $fn$
    select p.property_id, pr.line1, pr.town, pr.postcode, p.visibility, p.expires_at
    from passports p
    join properties pr on pr.id = p.property_id
    where p.slug = p_slug
      and p.revoked_at is null
      and p.deleted_at is null
      and (p.expires_at is null or p.expires_at > now())
  $fn$;

create or replace function public_pulse_request(p_token_hash text)
  returns table (id uuid, property_id uuid, expires_at timestamptz, already_answered boolean)
  language sql stable security definer set search_path = public as $fn$
    select r.id, r.property_id, r.expires_at,
           exists (select 1 from pulse_responses pr where pr.pulse_request_id = r.id)
    from pulse_requests r
    where r.token_hash = p_token_hash
      and r.deleted_at is null
      and r.expires_at > now()
  $fn$;

create or replace function public_pulse_answer(
  p_token_hash text, p_households integer, p_occupants integer
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_req pulse_requests;
    v_id uuid;
  begin
    select * into v_req from pulse_requests
      where token_hash = p_token_hash and deleted_at is null and expires_at > now();
    if v_req.id is null then
      raise exception 'invalid or expired link' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from pulse_responses where pulse_request_id = v_req.id) then
      raise exception 'already answered' using errcode = 'unique_violation';
    end if;
    insert into pulse_responses (account_id, pulse_request_id, households, occupants)
      values (v_req.account_id, v_req.id, p_households, p_occupants)
      returning id into v_id;
    return v_id;
  end;
  $fn$;

create or replace function public_capture_radar_signup(
  p_email text, p_postcode text, p_region itl1_region, p_count integer
) returns void
  language sql security definer set search_path = public as $fn$
    insert into radar_signups (email, postcode, itl1_region, property_count)
    values (p_email, p_postcode, p_region, p_count)
    on conflict (email, itl1_region) do update
      set postcode = excluded.postcode,
          property_count = excluded.property_count,
          updated_at = now()
  $fn$;
