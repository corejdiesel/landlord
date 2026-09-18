-- 0010_reminder_dedupe.sql — make reminder idempotency actually work.
--
-- The original constraint was:
--   unique (account_id, obligation_id, drift_item_id, registration_id, channel, scheduled_for)
--
-- Every obligation reminder leaves all three id columns NULL, and in SQL
-- NULL <> NULL, so those rows never conflicted with anything. `on conflict do
-- nothing` therefore did nothing, and running the job twice would have emailed
-- every landlord twice. For a product whose core promise is reminders, sending
-- duplicates is the fastest way to be muted — which is the same outcome as not
-- sending at all.
--
-- The fix is an explicit dedupe key that is never null and names the target
-- precisely: which obligation on which property, which drift item, which
-- renewal, and how many days out. Two different obligations due the same day
-- produce different keys and both send, which the naive COALESCE fix would have
-- collapsed into one.

alter table reminders drop constraint if exists
  reminders_account_id_obligation_id_drift_item_id_registratio_key;

alter table reminders add column if not exists dedupe_key text;

-- Backfill anything already scheduled, then make it mandatory.
update reminders
   set dedupe_key = coalesce(
     'obligation:' || obligation_id::text,
     'drift:' || drift_item_id::text,
     'renewal:' || registration_id::text,
     'legacy:' || id::text)
 where dedupe_key is null;

alter table reminders alter column dedupe_key set not null;

create unique index if not exists reminders_dedupe_idx
  on reminders (account_id, dedupe_key, channel, scheduled_for);
