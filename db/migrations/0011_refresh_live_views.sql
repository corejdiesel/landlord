-- 0011_refresh_live_views.sql — pick up columns added after a view was created.
--
-- `create view x as select * from y` resolves the star ONCE, at creation time,
-- and stores the resulting column list. Adding a column to the table afterwards
-- does not change the view, so `dedupe_key` (added in 0010) was invisible
-- through live_reminders even though it existed on the table.
--
-- This is a standing trap, not a one-off: any migration that adds a column to a
-- table with a live_* view must recreate that view too. Noted in
-- .claude/rules/conventions.md.

do $do$
declare
  t text;
  tables text[] := array[
    'memberships', 'landlord_entities', 'properties',
    'property_landlords', 'tenancies', 'registrations', 'register_snapshots',
    'drift_items', 'documents', 'inbound_emails', 'obligations', 'reminders',
    'pulse_requests', 'pulse_responses', 'passports', 'subscriptions', 'accounts'
  ];
begin
  foreach t in array tables loop
    execute format('drop view if exists live_%I', t);
    execute format('create view live_%1$s as select * from %1$I where deleted_at is null', t);
  end loop;
end;
$do$;
