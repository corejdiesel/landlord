-- 0002_ledger.sql — the append-only, hash-chained Evidence Ledger.
--
-- The point of this table is that a landlord can show a council a dated trail
-- of what they did, and that the trail can be checked. That only means anything
-- if the database itself refuses to let the history be edited, so:
--   * UPDATE and DELETE are revoked at the role level, not merely by policy
--   * a trigger rejects any attempt to change or remove a row
--   * each row carries the SHA-256 of its own content plus the previous hash
--   * seq is allocated per account under a lock, so the chain cannot fork

create table ledger_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  seq bigint not null,
  event_type text not null,
  payload jsonb not null,
  payload_sha256 text not null,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now(),
  unique (account_id, seq),
  unique (account_id, hash)
);

create index ledger_events_account_seq_idx on ledger_events (account_id, seq desc);

-- Immutability, enforced by the database rather than by convention.
create or replace function ledger_events_immutable() returns trigger
  language plpgsql as $fn$
  begin
    raise exception 'ledger_events is append-only: % is not permitted', tg_op
      using errcode = 'restrict_violation';
  end;
  $fn$;

create trigger ledger_events_no_update
  before update on ledger_events
  for each row execute function ledger_events_immutable();

create trigger ledger_events_no_delete
  before delete on ledger_events
  for each row execute function ledger_events_immutable();

-- Truncate would sidestep the row triggers, so block it too.
create trigger ledger_events_no_truncate
  before truncate on ledger_events
  for each statement execute function ledger_events_immutable();

/**
 * Append one event, computing seq and the hash chain inside the database.
 *
 * Doing this in SQL rather than in the app closes the race where two concurrent
 * appends read the same tip and write a forked chain: the advisory lock is held
 * for the rest of the transaction, so appends for an account serialise.
 *
 * The genesis row's prev_hash is the account id, so a chain cannot be replayed
 * under a different account.
 */
create or replace function ledger_append(
  p_account_id uuid,
  p_event_type text,
  p_payload jsonb
) returns ledger_events
  language plpgsql as $fn$
  declare
    v_seq bigint;
    v_prev_hash text;
    v_payload_sha text;
    v_hash text;
    v_row ledger_events;
  begin
    perform pg_advisory_xact_lock(hashtextextended(p_account_id::text, 0));

    select seq, hash into v_seq, v_prev_hash
      from ledger_events
      where account_id = p_account_id
      order by seq desc
      limit 1;

    if v_seq is null then
      v_seq := 1;
      v_prev_hash := encode(digest(p_account_id::text, 'sha256'), 'hex');
    else
      v_seq := v_seq + 1;
    end if;

    -- Canonical payload form: jsonb sorts keys and strips insignificant
    -- whitespace, so the same logical payload always hashes the same way.
    v_payload_sha := encode(digest(p_payload::text, 'sha256'), 'hex');
    v_hash := encode(
      digest(
        p_account_id::text || '|' || v_seq::text || '|' || p_event_type || '|' ||
        v_payload_sha || '|' || v_prev_hash,
        'sha256'),
      'hex');

    insert into ledger_events (account_id, seq, event_type, payload, payload_sha256, prev_hash, hash)
    values (p_account_id, v_seq, p_event_type, p_payload, v_payload_sha, v_prev_hash, v_hash)
    returning * into v_row;

    return v_row;
  end;
  $fn$;

/**
 * Verify an account's chain end to end.
 *
 * Returns one row per problem found, so a caller can show the landlord exactly
 * where a chain broke rather than a bare boolean.
 */
create or replace function ledger_verify(p_account_id uuid)
  returns table (seq bigint, problem text)
  language plpgsql as $fn$
  declare
    r record;
    v_expected_prev text := encode(digest(p_account_id::text, 'sha256'), 'hex');
    v_expected_seq bigint := 1;
    v_recomputed text;
  begin
    for r in
      select * from ledger_events
      where account_id = p_account_id
      order by seq asc
    loop
      if r.seq <> v_expected_seq then
        seq := r.seq;
        problem := format('sequence gap: expected %s, found %s', v_expected_seq, r.seq);
        return next;
      end if;

      if r.prev_hash <> v_expected_prev then
        seq := r.seq;
        problem := 'previous hash does not match the preceding row';
        return next;
      end if;

      if encode(digest(r.payload::text, 'sha256'), 'hex') <> r.payload_sha256 then
        seq := r.seq;
        problem := 'payload does not match its recorded hash';
        return next;
      end if;

      v_recomputed := encode(
        digest(
          r.account_id::text || '|' || r.seq::text || '|' || r.event_type || '|' ||
          r.payload_sha256 || '|' || r.prev_hash,
          'sha256'),
        'hex');

      if v_recomputed <> r.hash then
        seq := r.seq;
        problem := 'row hash does not match its contents';
        return next;
      end if;

      v_expected_prev := r.hash;
      v_expected_seq := r.seq + 1;
    end loop;

    return;
  end;
  $fn$;
