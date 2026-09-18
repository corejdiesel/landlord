-- 0012_public_reads_fix.sql — the public read functions returned nothing.
--
-- Third instance of the same mistake (see 0008 and 0009): a SECURITY DEFINER
-- function owned by the app role is STILL subject to every policy, because
-- FORCE ROW LEVEL SECURITY binds the owner. public_passport and
-- public_pulse_request read their tables with no account context, matched
-- nothing, and returned zero rows — so every passport was a 404 and every
-- check-in link looked invalid.
--
-- The write-side twin, public_pulse_answer, was already fixed in 0007, which is
-- exactly why this went unnoticed: answering worked, reading did not.
--
-- A test now asserts that every SECURITY DEFINER function touching an
-- RLS-protected table raises the bootstrap flag, so the class cannot recur.

create or replace function public_passport(p_slug text)
  returns table (
    property_id uuid,
    line1 text,
    town text,
    postcode text,
    visibility jsonb,
    expires_at timestamptz
  )
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    return query
      select p.property_id, pr.line1, pr.town, pr.postcode, p.visibility, p.expires_at
      from passports p
      join properties pr on pr.id = p.property_id
      where p.slug = p_slug
        and p.revoked_at is null
        and p.deleted_at is null
        and pr.deleted_at is null
        and (p.expires_at is null or p.expires_at > now());
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

create or replace function public_pulse_request(p_token_hash text)
  returns table (id uuid, property_id uuid, expires_at timestamptz, already_answered boolean)
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    perform set_config('app.bootstrap', 'on', true);
    return query
      select r.id, r.property_id, r.expires_at,
             exists (select 1 from pulse_responses pr where pr.pulse_request_id = r.id)
      from pulse_requests r
      where r.token_hash = p_token_hash
        and r.deleted_at is null
        and r.expires_at > now();
    perform set_config('app.bootstrap', 'off', true);
  end;
  $fn$;

-- passports needs a bootstrap read path, like accounts and properties already have.
create policy passports_bootstrap_select on passports for select
  using (app_is_bootstrapping());

create policy properties_bootstrap_select on properties for select
  using (app_is_bootstrapping());

create policy documents_bootstrap_select on documents for select
  using (app_is_bootstrapping());

create policy tenancies_bootstrap_select on tenancies for select
  using (app_is_bootstrapping());

create policy registrations_bootstrap_select on registrations for select
  using (app_is_bootstrapping());
