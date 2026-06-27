-- Migration 0005: scores, composite_scores

-- One current subscore per (award, scorer). Inputs snapshot kept so every
-- subscore is fully explainable / reproducible.
create table if not exists public.scores (
  id               uuid primary key default gen_random_uuid(),
  award_unique_id  text not null references public.awards(award_unique_id) on delete cascade,
  scorer_name      text not null,   -- NELA|CLUSTER|SOLECONC|COMPCOLLAPSE|MODBALLOON|PASSTHRU|FYE|PRICEOUT|GEOMISMATCH
  subscore         numeric not null,
  inputs           jsonb,           -- snapshot of the exact inputs that produced this subscore
  scored_at        timestamptz not null default now(),
  unique (award_unique_id, scorer_name)
);

create index if not exists scores_award_idx on public.scores (award_unique_id);
create index if not exists scores_scorer_idx on public.scores (scorer_name);

-- Composite Anomaly Score + tier. Component breakdown stored so any CAS
-- reproduces by hand from its parts.
create table if not exists public.composite_scores (
  award_unique_id  text primary key references public.awards(award_unique_id) on delete cascade,
  cas              numeric not null,
  tier             text not null check (tier in ('monitor','review','investigation')),
  components       jsonb not null,  -- { "NELA": {"subscore":x,"weight":w}, ... }
  scored_at        timestamptz not null default now()
);

create index if not exists composite_scores_tier_cas_idx on public.composite_scores (tier, cas desc);

comment on table public.composite_scores is
  'CAS is a prioritization signal, never a finding. It must never appear in published work as proof of wrongdoing.';
