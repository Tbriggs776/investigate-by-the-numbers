-- Migration 0011: nightly ingestion schedule (pg_cron + pg_net).
--
-- Requires a Vault secret named 'ingest_invoke_key' holding the project's anon
-- JWT (the public client key). It is created out-of-band, NOT in this migration,
-- so no key is committed. On a fresh project, create it once:
--   select vault.create_secret('<anon_key>', 'ingest_invoke_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior job of this name before (re)scheduling.
select cron.unschedule('ingest-awards-nightly')
where exists (select 1 from cron.job where jobname = 'ingest-awards-nightly');

select cron.schedule(
  'ingest-awards-nightly',
  '0 8 * * *',  -- 08:00 UTC daily
  $job$
  select net.http_post(
    url := 'https://ipdimgygevkwzjokcmvj.supabase.co/functions/v1/ingest-awards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ingest_invoke_key')
    ),
    body := jsonb_build_object('maxAwards', 1000, 'pageLimit', 100),
    timeout_milliseconds := 150000
  );
  $job$
);
