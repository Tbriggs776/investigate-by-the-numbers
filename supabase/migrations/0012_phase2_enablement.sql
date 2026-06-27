-- Migration 0012: Phase 2 (entity resolution) enablement.
--   (a) bonus SAM fields on entities
--   (b) service-role-only Vault secret reader (so edge functions fetch the SAM
--       key without exposing it via PostgREST)
--   (c) starter address_exclusions seed
--
-- Requires a Vault secret 'sam_api_key' (created out-of-band, not committed).

alter table public.entities add column if not exists registration_status text;
alter table public.entities add column if not exists registration_expiration_date date;
alter table public.entities add column if not exists exclusion_flag boolean;

-- Vault reader. Granted ONLY to service_role, which already has full DB access,
-- so this adds no privilege escalation and is NOT callable by anon/authenticated.
create or replace function public.get_vault_secret(p_name text)
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name
$$;
revoke all on function public.get_vault_secret(text) from public, anon, authenticated;
grant execute on function public.get_vault_secret(text) to service_role;

-- Starter address_exclusions: well-known registered-agent / mail-drop addresses
-- that would otherwise form false shared-address clusters. Grows over time.
insert into public.address_exclusions (address_normalized, match_type, reason, source) values
  ('251 LITTLE FALLS DR, WILMINGTON, DE 19808', 'exact', 'registered_agent', 'Corporation Service Company (CSC)'),
  ('1209 ORANGE ST, WILMINGTON, DE 19801',      'exact', 'registered_agent', 'CT Corporation / CSC mail-drop'),
  ('1521 CONCORD PIKE, WILMINGTON, DE 19803',   'exact', 'registered_agent', 'Registered Agents Inc'),
  ('108 W 13TH ST, WILMINGTON, DE 19801',       'exact', 'registered_agent', 'Incorporating Services Ltd'),
  ('850 NEW BURTON RD, DOVER, DE 19904',        'exact', 'registered_agent', 'Common DE registered-agent suite')
on conflict (address_normalized, match_type) do nothing;
