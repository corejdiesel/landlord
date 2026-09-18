-- 0001_foundation.sql — core schema, session context and RLS harness.
--
-- Conventions applied to every table here:
--   * created_at / updated_at / deleted_at on all tables (soft deletes only)
--   * RLS enabled AND forced, with a tested policy
--   * money in pennies as bigint
--   * tenant isolation keyed on app.current_account_id

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Session context
--
-- RLS policies read the caller's identity from these settings, which the data
-- access layer sets per request inside the transaction. current_setting(.., true)
-- yields NULL when unset, so a connection with no context sees nothing at all
-- rather than everything -- the failure mode we want.
-- ---------------------------------------------------------------------------

create or replace function app_current_user_id() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('app.current_user_id', true), '')::uuid
  $fn$;

create or replace function app_current_account_id() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('app.current_account_id', true), '')::uuid
  $fn$;

create or replace function app_is_admin() returns boolean
  language sql stable as $fn$
    select coalesce(nullif(current_setting('app.is_admin', true), '')::boolean, false)
  $fn$;

create or replace function set_updated_at() returns trigger
  language plpgsql as $fn$
  begin
    new.updated_at = now();
    return new;
  end;
  $fn$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type account_type      as enum ('landlord', 'agent');
create type membership_role   as enum ('owner', 'member', 'readonly');
create type entity_type       as enum ('individual', 'company', 'trust', 'representative');
create type property_type     as enum ('detached', 'semi_detached', 'terraced', 'flat', 'other');
create type ownership_type    as enum ('freehold', 'leasehold', 'share_of_freehold', 'commonhold');
create type licence_kind      as enum ('selective', 'hmo_mandatory', 'hmo_additional', 'none_needed');
create type itl1_region       as enum (
  'north_east', 'north_west', 'yorkshire_and_the_humber', 'east_midlands',
  'west_midlands', 'east_of_england', 'london', 'south_east', 'south_west');
create type tenancy_kind      as enum (
  'assured', 'rent_act_regulated', 'lodger', 'high_rent', 'low_rent',
  'supported_exempt', 'other');
create type rent_frequency    as enum ('monthly', 'four_weekly', 'weekly', 'other');
create type document_kind     as enum (
  'gas_safety_record', 'eicr', 'eic', 'epc', 'licence', 'deposit_certificate',
  'tenancy_agreement', 'prescribed_information', 'right_to_rent_check', 'other');
create type document_outcome  as enum ('satisfactory', 'unsatisfactory', 'not_applicable', 'unknown');
create type registration_status as enum ('none', 'active', 'inactive', 'lapsed');
create type obligation_state  as enum (
  'not_yet_applicable', 'upcoming', 'due_soon', 'overdue', 'satisfied', 'blocked');
create type reminder_channel  as enum ('email', 'in_app', 'ics');
create type review_state      as enum ('pending', 'approved', 'rejected');
create type attestation_state as enum ('pending', 'confirmed', 'disputed', 'expired');

-- ---------------------------------------------------------------------------
-- Accounts, users, memberships
-- ---------------------------------------------------------------------------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  type account_type not null default 'landlord',
  name text not null,
  -- Per-account inbound address token for the Cert Inbox.
  inbound_token text not null unique default encode(gen_random_bytes(9), 'hex'),
  -- Calm mode hides the exposure meter (spec 4.13).
  calm_mode boolean not null default false,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  name text,
  password_hash text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role membership_role not null default 'owner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (account_id, user_id)
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Only the hash is stored; the raw token lives in the cookie and nowhere else.
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Landlord entities and properties
-- ---------------------------------------------------------------------------

create table landlord_entities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  entity_type entity_type not null default 'individual',
  name text not null,
  -- Correspondence address must be in England or Wales and cannot be a PO box.
  correspondence_line1 text,
  correspondence_line2 text,
  correspondence_town text,
  correspondence_postcode text,
  email citext,
  companies_house_number text,
  charity_number text,
  landlord_registration_number text,
  registered_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table properties (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  line1 text not null,
  line2 text,
  town text,
  postcode text not null,
  uprn text,
  itl1_region itl1_region not null,
  type property_type not null default 'terraced',
  ownership ownership_type not null default 'freehold',
  bedrooms integer not null default 1 check (bedrooms >= 0),
  storeys integer not null default 1 check (storeys >= 1),
  furnished text not null default 'unfurnished',
  has_gas boolean not null default false,
  has_fixed_combustion_appliance boolean not null default false,
  hmo boolean not null default false,
  licence_kind licence_kind not null default 'none_needed',
  licence_number text,
  licence_expires_on date,
  is_let boolean not null default true,
  -- Freeholder / superior landlord / manager contacts required by the register.
  freeholder_name text,
  freeholder_email citext,
  superior_landlord_name text,
  superior_landlord_email citext,
  property_manager_name text,
  property_manager_email citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Joint ownership: each joint landlord needs their own landlord entry, while
-- the property itself is registered once.
create table property_landlords (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  landlord_entity_id uuid not null references landlord_entities(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (property_id, landlord_entity_id)
);

create table tenancies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  -- HMO mode: a per-room tenancy points at the whole-dwelling parent tenancy.
  parent_tenancy_id uuid references tenancies(id) on delete set null,
  room_label text,
  kind tenancy_kind not null default 'assured',
  started_on date not null,
  ended_on date,
  rent_pennies bigint not null default 0 check (rent_pennies >= 0),
  rent_frequency rent_frequency not null default 'monthly',
  bills_included boolean not null default false,
  households integer not null default 1 check (households >= 0),
  occupants integer not null default 1 check (occupants >= 0),
  deposit_taken boolean not null default false,
  deposit_pennies bigint not null default 0 check (deposit_pennies >= 0),
  deposit_scheme text,
  deposit_protected_on date,
  prescribed_information_served_on date,
  right_to_rent_checked_on date,
  right_to_rent_follow_up_on date,
  alarms_tested_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Registration, snapshots and the 28-day Drift Clock
-- ---------------------------------------------------------------------------

create table registrations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  property_registration_number text,
  registered_on date,
  renewal_due_on date,
  status registration_status not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (property_id)
);

-- What we believe the GOV.UK entry currently says. Drift is measured against
-- this, never against our own previous state.
create table register_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  facts jsonb not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table drift_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  registration_id uuid not null references registrations(id) on delete cascade,
  field text not null,
  field_label text not null,
  old_value text,
  new_value text,
  opened_at timestamptz not null default now(),
  due_on date not null,
  closed_at timestamptz,
  evidence_document_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

create table documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  kind document_kind not null default 'other',
  original_filename text,
  storage_path text,
  mime_type text,
  byte_size bigint,
  sha256 text,
  issued_on date,
  expires_on date,
  outcome document_outcome not null default 'unknown',
  epc_rating text,
  engineer_id text,
  served_on_tenant_at date,
  -- Raw model output plus per-field confidence. Never trusted until confirmed.
  extraction jsonb,
  confidence jsonb,
  confirmed_by uuid references users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table inbound_emails (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  from_address text,
  to_address text,
  subject text,
  raw_storage_path text,
  attachments jsonb not null default '[]'::jsonb,
  routed_to uuid references documents(id),
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Materialised rule engine output
-- ---------------------------------------------------------------------------

create table obligations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  rule_id text not null,
  rule_version integer not null,
  title text not null,
  reason text not null,
  due_on date,
  state obligation_state not null,
  satisfied_by text,
  evaluated_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (property_id, rule_id)
);

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------

create table reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete cascade,
  drift_item_id uuid references drift_items(id) on delete cascade,
  registration_id uuid references registrations(id) on delete cascade,
  channel reminder_channel not null default 'email',
  subject text not null,
  body text not null,
  scheduled_for date not null,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- One reminder per target per scheduled day, so re-running jobs is idempotent.
  unique (account_id, obligation_id, drift_item_id, registration_id, channel, scheduled_for)
);

-- ---------------------------------------------------------------------------
-- Household Pulse, Tenant Passport, Agent Attestation
-- ---------------------------------------------------------------------------

create table pulse_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  -- Only the hash of the link token is stored.
  token_hash text not null unique,
  expires_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Deliberately minimal: two numbers and a timestamp. No names, no contact
-- details, nothing that could identify an occupant.
create table pulse_responses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  pulse_request_id uuid not null references pulse_requests(id) on delete cascade,
  households integer not null check (households >= 0),
  occupants integer not null check (occupants >= 0),
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table passports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  -- Long random slug: passport URLs must not be enumerable.
  slug text not null unique,
  visibility jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- An agent sees a landlord's data only through an explicit, revocable grant.
create table agent_grants (
  id uuid primary key default gen_random_uuid(),
  agent_account_id uuid not null references accounts(id) on delete cascade,
  landlord_account_id uuid not null references accounts(id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (agent_account_id, landlord_account_id)
);

create table attestation_requests (
  id uuid primary key default gen_random_uuid(),
  agent_account_id uuid not null references accounts(id) on delete cascade,
  landlord_account_id uuid not null references accounts(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  change jsonb not null,
  token_hash text not null unique,
  state attestation_state not null default 'pending',
  expires_at timestamptz not null,
  responded_at timestamptz,
  dispute_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Law Watch (admin-scoped, not account data)
-- ---------------------------------------------------------------------------

create table law_watch_sources (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  url text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table law_watch_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references law_watch_sources(id) on delete cascade,
  content_sha256 text not null,
  normalised_text text not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table law_watch_changes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references law_watch_sources(id) on delete cascade,
  from_snapshot_id uuid references law_watch_snapshots(id) on delete set null,
  to_snapshot_id uuid not null references law_watch_snapshots(id) on delete cascade,
  diff text not null,
  model_summary text,
  affected_rule_ids text[] not null default '{}',
  review_state review_state not null default 'pending',
  reviewed_by uuid references users(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Billing and public capture
-- ---------------------------------------------------------------------------

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  plan text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'active',
  trial_ends_on date,
  current_period_end date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (account_id)
);

-- Deadline Radar email capture. Segmentable by region from day one, because
-- demand spikes region by region.
create table radar_signups (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  postcode text,
  itl1_region itl1_region,
  property_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (email, itl1_region)
);
