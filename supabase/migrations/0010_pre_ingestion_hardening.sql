-- Migration 0010: pre-ingestion hardening (from the Phase 0 schema review).
-- Applied while the DB is empty — cheap now, painful re-ingest/backfill later.
-- Methodology-dependent decisions (PRICEOUT data source, etc.) are NOT made here;
-- see docs/open-decisions.md.

-- ════ Blocker 1: subawards idempotency — deterministic NOT NULL conflict key ════
alter table public.subawards add column if not exists subaward_number text;
alter table public.subawards add column if not exists prime_award_unique_key text;
alter table public.subawards add column if not exists natural_key text;

create or replace function public.subawards_set_natural_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.natural_key := coalesce(
    nullif(new.subaward_unique_id, ''),
    md5(concat_ws('|',
      new.parent_award_id,
      coalesce(new.sub_recipient_uei, ''),
      coalesce(new.subaward_number, ''),
      coalesce(new.action_date::text, ''),
      coalesce(new.amount::text, '')
    ))
  );
  return new;
end; $$;

drop trigger if exists subawards_natural_key_trg on public.subawards;
create trigger subawards_natural_key_trg before insert or update on public.subawards
  for each row execute function public.subawards_set_natural_key();

alter table public.subawards alter column natural_key set not null;
alter table public.subawards drop constraint if exists subawards_subaward_unique_id_key;
alter table public.subawards add constraint subawards_natural_key_uq unique (natural_key);
alter table public.subawards alter column parent_award_id set not null;

comment on column public.subawards.natural_key is
  'Deterministic idempotency key + ON CONFLICT target. = subaward_unique_id when present, else md5(parent_award_id|sub_recipient_uei|subaward_number|action_date|amount). Set by trigger.';

-- ════ Blocker 2: fiscal_year derived from action_date (federal FY, Oct 1 start) ════
drop index if exists public.awards_fiscal_year_idx;
alter table public.awards drop column if exists fiscal_year;
alter table public.awards add column fiscal_year integer
  generated always as (extract(year from (action_date + interval '3 months'))::int) stored;
create index awards_fiscal_year_idx on public.awards (fiscal_year);

-- ════ awards.uei delete semantics: SET NULL → RESTRICT (no silent vendor orphaning) ════
alter table public.awards drop constraint if exists awards_uei_fkey;
alter table public.awards add constraint awards_uei_fkey
  foreign key (uei) references public.entities(uei) on delete restrict;

-- ════ raw_awards → awards write-order contract: raw is source-of-truth, written first ════
alter table public.awards add constraint awards_raw_fkey
  foreign key (award_unique_id) references public.raw_awards(award_unique_id) on delete cascade;

-- ════ updated_at touch on awards + entities (raw_awards uses fetched_at, set by ingest) ════
drop trigger if exists awards_touch on public.awards;
create trigger awards_touch before update on public.awards
  for each row execute function public.touch_updated_at();
drop trigger if exists entities_touch on public.entities;
create trigger entities_touch before update on public.entities
  for each row execute function public.touch_updated_at();

-- ════ entities: structural stub/enriched + CAGE + initial registration ════
alter table public.entities add column if not exists enrichment_status text not null default 'stub'
  check (enrichment_status in ('stub', 'enriched'));
alter table public.entities add column if not exists cage_code text;
alter table public.entities add column if not exists initial_registration_date date;
create index if not exists entities_cage_code_idx on public.entities (cage_code);

comment on column public.entities.enrichment_status is
  'stub (ingest FK placeholder) until Phase 2 SAM enrichment sets enriched + enriched_at. Stub upserts MUST NOT downgrade an enriched row (WHERE enriched_at IS NULL).';
comment on column public.entities.initial_registration_date is
  'First-ever SAM registration (NELA new-entity signal), distinct from the renewable registration_date.';

-- ════ awards: preserve raw recipient UEI + free scorer-readiness columns ════
alter table public.awards add column if not exists raw_recipient_uei text;
alter table public.awards add column if not exists piid text;
alter table public.awards add column if not exists base_award_unique_key text;
alter table public.awards add column if not exists awarding_office_code text;
alter table public.awards add column if not exists awarding_office_name text;
alter table public.awards add column if not exists funding_office_code text;
alter table public.awards add column if not exists funding_office_name text;
alter table public.awards add column if not exists place_of_performance_country_code text;
alter table public.awards add column if not exists place_of_performance_city text;
alter table public.awards add column if not exists place_of_performance_county text;
alter table public.awards add column if not exists solicitation_procedures text;
alter table public.awards add column if not exists other_than_full_and_open_competition text;
create index if not exists awards_office_naics_idx on public.awards (awarding_office_code, naics);
create index if not exists awards_base_key_idx on public.awards (base_award_unique_key);

comment on column public.awards.uei is
  'Resolved entity UEI (nullable FK, ON DELETE RESTRICT). raw_recipient_uei holds the source value as ingested; NULL uei + non-null raw_recipient_uei means UNRESOLVED, not "no UEI in source".';
comment on column public.awards.base_award_unique_key is
  'Stable key shared by a base award and all its modifications (group/order by modification_number, action_date) — MODBALLOON lineage. Distinct from parent_award_id (IDV parent).';
