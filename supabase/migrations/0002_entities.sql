-- Migration 0002: entities (one row per UEI)

create table if not exists public.entities (
  uei                 text primary key,
  legal_name          text,
  registration_date   date,
  -- normalized + geocoded address (Phase 2 enrichment)
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  zip                 text,
  address_normalized  text,            -- canonical form for clustering + exclusion matching
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  geocode_precision   text,            -- rooftop | suite | street | city | none
  socioeconomic       jsonb,           -- set-aside / small-business / 8(a) / SDVOSB flags
  naics_primary       text,
  prior_uei           text,
  prior_duns          text,
  source              text not null default 'SAM.gov',
  enriched_at         timestamptz,     -- null until Phase 2 enrichment runs
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists entities_address_normalized_idx on public.entities (address_normalized);
create index if not exists entities_state_idx on public.entities (state);

comment on column public.entities.source is
  'Ingestion (Phase 1) upserts a minimal stub (source=USAspending-stub) so award FKs hold; Phase 2 enriches from SAM.gov and sets source=SAM.gov.';
