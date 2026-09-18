-- 0007 — separate tenancy isolation from soft-delete visibility, and let the
--        public definer functions write the two tables they need.
--
-- WHY THE SELECT POLICIES CHANGE
--
-- PostgreSQL applies a table's SELECT policy to the row produced by an UPDATE.
-- Our SELECT policies read `... and deleted_at is null`, so `update properties
-- set deleted_at = now()` produced a row the policy rejected, and soft delete —
-- the schema's only delete mechanism — failed with a policy violation.
--
-- The fix is a separation of concerns rather than a workaround. RLS exists here
-- to answer "whose row is this?", which is a security boundary. "Is this row
-- still live?" is a business rule. Folding the second into the policy made one
-- expression serve two purposes and broke one of them.
--
-- Soft-delete filtering now lives in the data access layer, and each table gets
-- a `live_*` view so a caller cannot forget. The RLS tests assert both: that
-- another account sees nothing, and that a deleted row is gone from the view.

do $do$
declare
  t text;
  account_scoped text[] := array[
    'memberships', 'landlord_entities', 'properties',
    'property_landlords', 'tenancies', 'registrations', 'register_snapshots',
    'drift_items', 'documents', 'inbound_emails', 'obligations', 'reminders',
    'pulse_requests', 'pulse_responses', 'passports', 'subscriptions'
  ];
begin
  foreach t in array account_scoped loop
    execute format('alter policy %1$s_select on %1$I using (app_can_access_account(account_id))', t);
    execute format('create view live_%1$s as select * from %1$I where deleted_at is null', t);
  end loop;
end;
$do$;

alter policy accounts_select on accounts using (app_can_access_account(id));
create view live_accounts as select * from accounts where deleted_at is null;

alter policy users_select on users using (
  id = app_current_user_id()
  or exists (
    select 1 from memberships m
    where m.user_id = users.id
      and m.account_id = app_current_account_id()
      and m.deleted_at is null
  )
);

alter policy agent_grants_select on agent_grants using (
  agent_account_id = app_current_account_id()
  or landlord_account_id = app_current_account_id()
);

alter policy attestation_select on attestation_requests using (
  agent_account_id = app_current_account_id()
  or landlord_account_id = app_current_account_id()
);

alter policy law_sources_select on law_watch_sources using (true);
alter policy law_changes_select on law_watch_changes using (
  app_is_admin() or (review_state = 'approved' and published_at is not null)
);

-- ---------------------------------------------------------------------------
-- Public definer functions need a write path.
--
-- radar_signups and pulse_responses are written by visitors who have no account
-- context at all — a prospect on the public Radar page, a tenant following a
-- one-time link. Both go through SECURITY DEFINER functions that validate the
-- input first; these policies give those functions, and only those functions,
-- somewhere to put the row. The flag is transaction-local and is never raised
-- by application code.
-- ---------------------------------------------------------------------------

create policy radar_signups_public_insert on radar_signups for insert
  with check (app_is_bootstrapping());
create policy radar_signups_public_update on radar_signups for update
  using (app_is_bootstrapping()) with check (app_is_bootstrapping());
create policy radar_signups_public_select on radar_signups for select
  using (app_is_bootstrapping());

create policy pulse_responses_public_insert on pulse_responses for insert
  with check (app_is_bootstrapping());
create policy pulse_responses_public_select on pulse_responses for select
  using (app_is_bootstrapping());

create or replace function public_capture_radar_signup(
  p_email text, p_postcode text, p_region itl1_region, p_count integer
) returns void
  language plpgsql security definer set search_path = public as $fn$
  begin
    if p_email is null or position('@' in p_email) = 0 then
      raise exception 'a valid email is required' using errcode = 'invalid_parameter_value';
    end if;
    perform set_config('app.bootstrap', 'on', true);
    insert into radar_signups (email, postcode, itl1_region, property_count)
    values (p_email, p_postcode, p_region, p_count)
    on conflict (email, itl1_region) do update
      set postcode = excluded.postcode,
          property_count = excluded.property_count,
          updated_at = now();
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

create or replace function public_pulse_answer(
  p_token_hash text, p_households integer, p_occupants integer
) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_req pulse_requests;
    v_id uuid;
  begin
    if p_households is null or p_households < 0 or p_households > 50
       or p_occupants is null or p_occupants < 0 or p_occupants > 200 then
      raise exception 'answers out of range' using errcode = 'invalid_parameter_value';
    end if;

    perform set_config('app.bootstrap', 'on', true);

    select * into v_req from pulse_requests
      where token_hash = p_token_hash and deleted_at is null and expires_at > now();
    if v_req.id is null then
      perform set_config('app.bootstrap', 'off', true);
      raise exception 'invalid or expired link' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from pulse_responses where pulse_request_id = v_req.id) then
      perform set_config('app.bootstrap', 'off', true);
      raise exception 'already answered' using errcode = 'unique_violation';
    end if;

    insert into pulse_responses (account_id, pulse_request_id, households, occupants)
      values (v_req.account_id, v_req.id, p_households, p_occupants)
      returning id into v_id;

    perform set_config('app.bootstrap', 'off', true);
    return v_id;
  end;
  $fn$;

-- pulse_requests is read by the same definer function; give it the same path.
create policy pulse_requests_public_select on pulse_requests for select
  using (app_is_bootstrapping());
