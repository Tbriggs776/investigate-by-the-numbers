-- Investigate by the Numbers — Phase 0
-- Migration 0001: extensions + config
-- Every regulatory/scoring threshold lives here, never hardcoded in a scorer.

create extension if not exists pgcrypto;

create table if not exists public.config (
  key          text primary key,
  value        jsonb not null,
  description  text,
  updated_at   timestamptz not null default now()
);

comment on table public.config is
  'Tunable thresholds + parameters, sourced from the methodology document. No threshold is ever hardcoded in a scorer — scorers read from here.';
