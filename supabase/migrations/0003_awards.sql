-- Migration 0003: raw_awards, awards, subawards

-- Untouched USAspending payload, keyed by the stable generated unique award id.
create table if not exists public.raw_awards (
  award_unique_id  text primary key,
  raw              jsonb not null,
  piid             text,           -- denormalized for quick filtering
  uei              text,
  source           text not null default 'USAspending',
  fetched_at       timestamptz not null default now()
);

create index if not exists raw_awards_uei_idx on public.raw_awards (uei);

-- Normalized award facts. uei references entities (stub created at ingest).
create table if not exists public.awards (
  award_unique_id              text primary key,
  uei                          text references public.entities(uei) on delete set null,
  recipient_name               text,
  awarding_agency              text,
  awarding_sub_agency          text,
  funding_agency               text,
  funding_sub_agency           text,
  obligation                   numeric(18,2),
  base_value                   numeric(18,2),
  current_total_value          numeric(18,2),
  action_date                  date,
  fiscal_year                  integer,
  period_of_performance_start  date,
  period_of_performance_end    date,
  naics                        text,
  naics_description            text,
  psc                          text,
  psc_description              text,
  extent_competed              text,
  offers_received              integer,
  set_aside_type               text,
  type_of_contract_pricing     text,
  parent_award_id              text,         -- IDV / parent for modifications
  modification_number          text,
  place_of_performance_state   text,
  place_of_performance_zip     text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);

create index if not exists awards_uei_idx on public.awards (uei);
create index if not exists awards_agency_naics_idx on public.awards (awarding_agency, naics);
create index if not exists awards_fiscal_year_idx on public.awards (fiscal_year);
create index if not exists awards_parent_idx on public.awards (parent_award_id);
create index if not exists awards_pop_state_idx on public.awards (place_of_performance_state);

comment on table public.awards is
  'Normalized award facts. Trend logic is restricted to fiscal_year >= config.trend.fy_floor (2017).';

-- Sub-recipient detail (pass-through analysis).
create table if not exists public.subawards (
  id                   uuid primary key default gen_random_uuid(),
  subaward_unique_id   text unique,    -- natural key for idempotent upsert
  parent_award_id      text references public.awards(award_unique_id) on delete cascade,
  sub_recipient_name   text,
  sub_recipient_uei    text,
  amount               numeric(18,2),
  sub_business_size    text,
  action_date          date,
  created_at           timestamptz not null default now()
);

create index if not exists subawards_parent_idx on public.subawards (parent_award_id);
