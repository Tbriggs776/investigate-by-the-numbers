-- Migration 0004: address_exclusions
-- Known coworking / registered-agent / incubator addresses, suppressed from
-- clustering so shared-address scorers don't false-positive on them.

create table if not exists public.address_exclusions (
  id                  uuid primary key default gen_random_uuid(),
  address_normalized  text not null,
  match_type          text not null default 'exact',  -- exact | zip | pattern
  reason              text,                            -- coworking | registered_agent | incubator | other
  source              text,
  created_at          timestamptz not null default now(),
  unique (address_normalized, match_type)
);

create index if not exists address_exclusions_norm_idx on public.address_exclusions (address_normalized);
