-- Migration 0017: Backtest Harness (Phase 6) — an isolated mirror of the live
-- anomaly engine. Scores prosecuted-case award data WITHOUT touching the live
-- leads: separate `backtest` schema, same scorer logic (mirrored from 0014 +
-- 0016 corrections; public.awards/entities/subawards -> backtest.*). config,
-- cfg()/cfg_num(), and address_exclusions stay SHARED with public so the engine
-- is identical. Faithfulness is proven by re-scoring the live population through
-- it and checking CAS matches public.composite_scores exactly (157/157, 0 diff).
-- The backtest schema is NOT exposed to PostgREST (anon/authenticated never reach it).

create schema if not exists backtest;
revoke all on schema backtest from anon, authenticated;

-- ── isolated data tables (self-contained; no FK back to public) ──
create table if not exists backtest.entities (like public.entities including all);
create table if not exists backtest.awards   (like public.awards including all);
create table if not exists backtest.subawards (
  id uuid primary key default gen_random_uuid(),
  parent_award_id text,
  sub_recipient_uei text,
  amount numeric,
  subaward_unique_id text
);
create table if not exists backtest.scores (like public.scores including all);
create table if not exists backtest.composite_scores (like public.composite_scores including all);

-- ── the labeled, citation-verified prosecuted-case registry ──
create table if not exists backtest.cases (
  id uuid primary key default gen_random_uuid(),
  case_name text not null,
  vendor_names text[],
  uei text, duns text, cage text,
  case_year int,
  agency text,
  contract_value_usd numeric,
  scheme_summary text,
  expected_dimensions text[],
  fpds_visibility text check (fpds_visibility in ('visible','partial','blindspot')),
  data_provenance text check (data_provenance in ('real','fixture','none')) default 'none',
  retrieval_hint text,
  citations jsonb default '[]'::jsonb,
  award_unique_ids text[] default '{}',
  verdict text,
  notes text,
  created_at timestamptz default now()
);
comment on table backtest.cases is 'Citation-verified prosecuted federal contracting fraud cases for the Phase 6 backtest. data_provenance: real=actual USAspending awards scored; fixture=documented reconstruction; none=not scorable.';

-- ── mirrored scorer views (live logic; data refs -> backtest.*) ──

-- NELA (0014)
create or replace view backtest.score_nela as
with t as (
  select a.award_unique_id, a.obligation, a.offers_received, a.action_date,
         e.initial_registration_date as reg_date, e.prior_uei, e.prior_duns,
         (a.action_date - e.initial_registration_date) as age_days
  from backtest.awards a
  join backtest.entities e on e.uei = a.uei
  where e.initial_registration_date is not null and a.action_date is not null
)
select award_unique_id,
  case
    when prior_uei is not null or prior_duns is not null then 0
    when age_days < public.cfg_num('scorer.NELA.max_age_days')
     and obligation > public.cfg_num('scorer.NELA.min_obligation')
     and coalesce(offers_received, 999) <= public.cfg_num('scorer.NELA.max_offers')
    then least(100, 60 + 40 * (obligation - public.cfg_num('scorer.NELA.min_obligation'))
                / nullif(public.cfg_num('scorer.NELA.escalate_obligation') - public.cfg_num('scorer.NELA.min_obligation'),0))
    else 0
  end as subscore,
  jsonb_build_object('age_days', age_days, 'obligation', obligation, 'offers_received', offers_received,
    'registration_date', reg_date, 'has_prior_lineage', (prior_uei is not null or prior_duns is not null)) as inputs
from t;

-- CLUSTER (0014); address_exclusions stays shared (public)
create or replace view backtest.score_cluster as
with addr as (
  select e.address_normalized, count(distinct e.uei) as uei_count
  from backtest.entities e
  where e.address_normalized is not null
    and not exists (select 1 from public.address_exclusions x
                    where x.match_type='exact' and x.address_normalized = e.address_normalized)
  group by e.address_normalized
  having count(distinct e.uei) >= public.cfg_num('scorer.CLUSTER.review_size')
)
select a.award_unique_id,
  case when ad.uei_count >= public.cfg_num('scorer.CLUSTER.investigation_size')
       then least(100, 70 + 10*(ad.uei_count - public.cfg_num('scorer.CLUSTER.investigation_size')))
       else 50 end as subscore,
  jsonb_build_object('shared_address', ad.address_normalized, 'cluster_size', ad.uei_count) as inputs
from addr ad
join backtest.entities e on e.address_normalized = ad.address_normalized
join backtest.awards a on a.uei = e.uei;

-- PASSTHRU (0016)
create or replace view backtest.score_passthru as
with sub as (select parent_award_id, sum(amount) as sub_total from backtest.subawards group by parent_award_id),
t as (
  select a.award_unique_id, a.set_aside_type, a.obligation, sub.sub_total,
    sub.sub_total / nullif(a.obligation,0) as passthrough_ratio
  from backtest.awards a
  join sub on sub.parent_award_id = a.award_unique_id
  where a.obligation > 0
    and upper(trim(a.set_aside_type)) in (select upper(jsonb_array_elements_text(public.cfg('scorer.PASSTHRU.qualifying_set_aside_codes'))))
)
select award_unique_id,
  least(100, 50 + 100 * greatest(0, passthrough_ratio - (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor')))) as subscore,
  jsonb_build_object('set_aside_type', set_aside_type, 'subaward_total', sub_total, 'obligation', obligation,
    'passthrough_ratio', round(passthrough_ratio,3),
    'note','sub business size not captured (large-sub unconfirmed); FSRS subaward $ vs FPDS obligation may not reconcile (ratio can exceed 1); subaward coverage is partial') as inputs
from t
where passthrough_ratio > (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor'));

-- MODBALLOON (0016 — disabled)
create or replace view backtest.score_modballoon as
select award_unique_id, 0::numeric as subscore, '{}'::jsonb as inputs
from backtest.awards where false;

-- SOLECONC (0016)
create or replace view backtest.score_soleconc as
with pair as (
  select a.awarding_sub_agency, a.uei,
    count(*) as award_count,
    sum(a.obligation) as total_oblig,
    sum(a.obligation) filter (
      where upper(trim(a.extent_competed)) not in (select upper(jsonb_array_elements_text(public.cfg('competition.competed_codes'))))
         or a.extent_competed is null) as noncompeted_oblig
  from backtest.awards a
  where a.uei is not null and a.awarding_sub_agency is not null
    and a.fiscal_year >= public.cfg_num('trend.fy_floor')
  group by a.awarding_sub_agency, a.uei
),
fp as (
  select *, noncompeted_oblig / nullif(total_oblig,0) as nc_share from pair
  where award_count >= public.cfg_num('scorer.SOLECONC.min_awards')
    and total_oblig > public.cfg_num('scorer.SOLECONC.min_cumulative')
    and noncompeted_oblig / nullif(total_oblig,0) > public.cfg_num('scorer.SOLECONC.max_noncompeted_share')
)
select a.award_unique_id,
  least(100, 60 + 40 * least(1, (fp.nc_share - public.cfg_num('scorer.SOLECONC.max_noncompeted_share'))
                                / (1 - public.cfg_num('scorer.SOLECONC.max_noncompeted_share')))) as subscore,
  jsonb_build_object('sub_agency', fp.awarding_sub_agency, 'award_count', fp.award_count,
    'noncompeted_share', round(fp.nc_share,3), 'cumulative_obligation', fp.total_oblig,
    'note','null extent_competed counted as non-competed (may be missing/summary data); benign: valid J&A (only responsible source, urgency, follow-on) — pull the J&A; window is FY2017+') as inputs
from fp
join backtest.awards a on a.awarding_sub_agency = fp.awarding_sub_agency and a.uei = fp.uei
where a.fiscal_year >= public.cfg_num('trend.fy_floor');

-- COMPCOLLAPSE (0016)
create or replace view backtest.score_compcollapse as
with flagged as (
  select a.award_unique_id, a.uei, a.awarding_sub_agency, a.offers_received
  from backtest.awards a
  where a.uei is not null and a.awarding_sub_agency is not null
    and a.fiscal_year >= public.cfg_num('trend.fy_floor')
    and upper(trim(a.extent_competed)) in (select upper(jsonb_array_elements_text(public.cfg('competition.competed_codes'))))
    and a.offers_received = public.cfg_num('scorer.COMPCOLLAPSE.offers_equal')
),
reps as (select uei, awarding_sub_agency, count(*) as rep_count from flagged group by uei, awarding_sub_agency)
select f.award_unique_id,
  least(100, 50 + 50 * least(1, (r.rep_count - 1)::numeric
                / nullif(public.cfg_num('scorer.COMPCOLLAPSE.escalate_repetitions') - 1,0))) as subscore,
  jsonb_build_object('offers_received', f.offers_received, 'repetition_count', r.rep_count, 'sub_agency', f.awarding_sub_agency,
    'note','single offer on a niche/narrow requirement can be benign; weight rests on (vendor, sub-agency) repetition') as inputs
from flagged f join reps r on r.uei = f.uei and r.awarding_sub_agency = f.awarding_sub_agency;

-- PRICEOUT (0016)
create or replace view backtest.score_priceout as
with psc_stats as (
  select psc, avg(obligation)::numeric as mean_oblig,
    percentile_cont(0.5) within group (order by obligation)::numeric as median_oblig,
    stddev_pop(obligation)::numeric as sd_oblig, count(*) as n
  from backtest.awards where psc is not null and obligation > 0
  group by psc having count(*) >= public.cfg_num('scorer.PRICEOUT.min_peers')
),
t as (
  select a.award_unique_id, a.psc, a.obligation, s.mean_oblig, s.median_oblig, s.sd_oblig, s.n,
    case when s.sd_oblig > 0 then (a.obligation - s.mean_oblig)/s.sd_oblig else 0 end as z,
    a.obligation / nullif(s.median_oblig,0) as median_mult_ratio
  from backtest.awards a join psc_stats s on s.psc = a.psc where a.obligation > 0
)
select award_unique_id,
  greatest(
    least(100, 50 + 25 * greatest(0, z - public.cfg_num('scorer.PRICEOUT.stddev_mult'))),
    least(100, 50 + 25 * greatest(0, median_mult_ratio - public.cfg_num('scorer.PRICEOUT.median_mult')))
  ) as subscore,
  jsonb_build_object('psc', psc, 'obligation', obligation, 'psc_mean', round(mean_oblig,0), 'psc_median', round(median_oblig,0),
    'z_score', round(z,2), 'median_multiple', round(median_mult_ratio,2), 'peer_n', n,
    'proxy','obligation, not unit price (USAspending has none); benign confounders unresolved: geography, urgency, spec differences, contract vehicle/IDV') as inputs
from t
where (z > public.cfg_num('scorer.PRICEOUT.stddev_mult'))
   or (median_mult_ratio > public.cfg_num('scorer.PRICEOUT.median_mult'));

-- FYE (0016)
create or replace view backtest.score_fye as
with office_fy as (
  select awarding_sub_agency, fiscal_year, sum(obligation) as total_oblig,
    sum(obligation) filter (where to_char(action_date,'MM-DD') >= (public.cfg('scorer.FYE.late_window_start') #>> '{}')
                              and to_char(action_date,'MM-DD') <= '09-30') as late_oblig
  from backtest.awards
  where awarding_sub_agency is not null and action_date is not null and obligation is not null
    and fiscal_year >= public.cfg_num('trend.fy_floor')
  group by awarding_sub_agency, fiscal_year
),
fo as (
  select *, late_oblig/nullif(total_oblig,0) as late_share from office_fy
  where total_oblig >= public.cfg_num('scorer.FYE.min_annual_oblig')
    and late_oblig/nullif(total_oblig,0) > public.cfg_num('scorer.FYE.office_late_share')
)
select a.award_unique_id,
  least(100, 40 + 60 * least(1, (fo.late_share - public.cfg_num('scorer.FYE.office_late_share'))
                                / (1 - public.cfg_num('scorer.FYE.office_late_share')))) as subscore,
  jsonb_build_object('sub_agency', fo.awarding_sub_agency, 'fiscal_year', fo.fiscal_year,
    'office_late_share', round(fo.late_share,3), 'annual_obligation', fo.total_oblig,
    'note','year-end spending is partly normal — context amplifier only; grain is sub-agency (not office) and counts base awards SIGNED in the window; vendor-share prong deferred') as inputs
from fo
join backtest.awards a on a.awarding_sub_agency = fo.awarding_sub_agency and a.fiscal_year = fo.fiscal_year
  and to_char(a.action_date,'MM-DD') >= (public.cfg('scorer.FYE.late_window_start') #>> '{}')
  and to_char(a.action_date,'MM-DD') <= '09-30';

-- GEOMISMATCH (0016)
create or replace view backtest.score_geomismatch as
select a.award_unique_id,
  public.cfg_num('scorer.GEOMISMATCH.base_subscore') as subscore,
  jsonb_build_object('entity_state', e.state, 'pop_state', a.place_of_performance_state,
    'note','state-level proxy only; for a services NAICS a state mismatch is EXPECTED-BENIGN (remote/distributed work). Real site-type needs property records. Unenriched entities (null state) are excluded.') as inputs
from backtest.awards a
join backtest.entities e on e.uei = a.uei
where e.state is not null and a.place_of_performance_state is not null
  and upper(trim(e.state)) <> upper(trim(a.place_of_performance_state));

-- ── orchestration (mirrors 0014; backtest.* + shared public.cfg) ──
create or replace function backtest.run_scoring() returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  truncate backtest.scores;
  for m in select * from (values
    ('score_nela','NELA'),('score_cluster','CLUSTER'),('score_passthru','PASSTHRU'),
    ('score_modballoon','MODBALLOON'),('score_soleconc','SOLECONC'),('score_compcollapse','COMPCOLLAPSE'),
    ('score_priceout','PRICEOUT'),('score_fye','FYE'),('score_geomismatch','GEOMISMATCH')
  ) as v(view_name, scorer_name) loop
    execute format(
      'insert into backtest.scores (award_unique_id, scorer_name, subscore, inputs, scored_at)
       select award_unique_id, %L, round(subscore,2), inputs, now() from backtest.%I where subscore > 0',
      m.scorer_name, m.view_name);
  end loop;
end; $$;

create or replace function backtest.compute_composite() returns void
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.cfg('composite.weights'); t jsonb := public.cfg('composite.tiers');
begin
  truncate backtest.composite_scores;
  insert into backtest.composite_scores (award_unique_id, cas, tier, components, scored_at)
  select a.award_unique_id,
    round(coalesce(sum((w ->> s.scorer_name)::numeric * s.subscore),0)/100.0, 2) as cas,
    case
      when coalesce(sum((w ->> s.scorer_name)::numeric * s.subscore),0)/100.0 >= (t #>> '{investigation,0}')::numeric then 'investigation'
      when coalesce(sum((w ->> s.scorer_name)::numeric * s.subscore),0)/100.0 >= (t #>> '{review,0}')::numeric then 'review'
      else 'monitor'
    end as tier,
    coalesce(jsonb_object_agg(s.scorer_name, jsonb_build_object('subscore', s.subscore, 'weight', (w->>s.scorer_name)::numeric))
             filter (where s.scorer_name is not null), '{}'::jsonb) as components,
    now()
  from backtest.awards a
  left join backtest.scores s on s.award_unique_id = a.award_unique_id
  group by a.award_unique_id;
end; $$;

create or replace function backtest.run_all_scoring() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform backtest.run_scoring();
  perform backtest.compute_composite();
  select jsonb_build_object(
    'scored_awards', (select count(*) from backtest.composite_scores),
    'flagged_rows', (select count(*) from backtest.scores),
    'investigation', (select count(*) from backtest.composite_scores where tier='investigation'),
    'review', (select count(*) from backtest.composite_scores where tier='review'),
    'monitor', (select count(*) from backtest.composite_scores where tier='monitor')
  ) into result;
  return result;
end; $$;

revoke all on function backtest.run_all_scoring() from public, anon, authenticated;
grant execute on function backtest.run_all_scoring() to service_role;
