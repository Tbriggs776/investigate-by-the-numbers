-- Migration 0014: the anomaly engine — nine scorer views + orchestration + composite.
-- Each scorer is its own readable SQL view returning (award_unique_id, subscore 0-100, inputs jsonb).
-- Thresholds come from config (never hardcoded). run_all_scoring() rebuilds scores + composite.
--
-- Data-reach notes (methodology permits proxies "where available"):
--   PRICEOUT  : obligation-per-PSC proxy (USAspending has no unit price).
--   MODBALLOON: current_total_value/base_value ratio (mod-vs-option distinction deferred).
--   CLUSTER   : address-only (officer/agent dimension needs the Dossier agent).
--   GEOMISMATCH: entity-state vs PoP-state (site-type needs property records).
--   PASSTHRU  : ratio-only (sub business-size not captured; large-sub unconfirmed).

-- ── config helpers ──
create or replace function public.cfg(p_key text) returns jsonb
  language sql stable set search_path = '' as $$ select value from public.config where key = p_key $$;
create or replace function public.cfg_num(p_key text) returns numeric
  language sql stable set search_path = '' as $$ select (value #>> '{}')::numeric from public.config where key = p_key $$;

-- ── 1. NELA — new entity, large award, thin competition ──
create or replace view public.score_nela as
with t as (
  select a.award_unique_id, a.obligation, a.offers_received, a.action_date,
         e.initial_registration_date as reg_date, e.prior_uei, e.prior_duns,
         (a.action_date - e.initial_registration_date) as age_days
  from public.awards a
  join public.entities e on e.uei = a.uei
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

-- ── 2. CLUSTER — shared suite-level address across distinct UEIs (excl. known agent addrs) ──
create or replace view public.score_cluster as
with addr as (
  select e.address_normalized, count(distinct e.uei) as uei_count
  from public.entities e
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
join public.entities e on e.address_normalized = ad.address_normalized
join public.awards a on a.uei = e.uei;

-- ── 3. PASSTHRU — set-aside prime routing most work to subs ──
create or replace view public.score_passthru as
with sub as (
  select parent_award_id, sum(amount) as sub_total
  from public.subawards group by parent_award_id
),
t as (
  select a.award_unique_id, a.set_aside_type, a.obligation, sub.sub_total,
    sub.sub_total / nullif(a.obligation,0) as passthrough_ratio
  from public.awards a
  join sub on sub.parent_award_id = a.award_unique_id
  where a.set_aside_type is not null and a.set_aside_type <> '' and a.obligation > 0
)
select award_unique_id,
  least(100, 50 + 100 * greatest(0, passthrough_ratio - (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor')))) as subscore,
  jsonb_build_object('set_aside_type', set_aside_type, 'subaward_total', sub_total, 'obligation', obligation,
    'passthrough_ratio', round(passthrough_ratio,3), 'note','sub business size not captured; large-sub unconfirmed') as inputs
from t
where passthrough_ratio > (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor'));

-- ── 4. MODBALLOON — current ceiling far above base ──
create or replace view public.score_modballoon as
with t as (
  select award_unique_id, base_value, current_total_value,
    current_total_value / nullif(base_value,0) as growth_ratio
  from public.awards where base_value > 0 and current_total_value is not null
)
select award_unique_id,
  least(100, 50 + 50 * least(1, (growth_ratio - public.cfg_num('scorer.MODBALLOON.growth_multiple'))
                                / public.cfg_num('scorer.MODBALLOON.growth_multiple'))) as subscore,
  jsonb_build_object('base_value', base_value, 'current_total_value', current_total_value,
    'growth_ratio', round(growth_ratio,2), 'note','mod-vs-option distinction deferred') as inputs
from t
where growth_ratio > public.cfg_num('scorer.MODBALLOON.growth_multiple');

-- ── 5. SOLECONC — sub-agency/vendor pair, high non-competed share + cumulative $ ──
create or replace view public.score_soleconc as
with pair as (
  select a.awarding_sub_agency, a.uei,
    sum(a.obligation) as total_oblig,
    sum(a.obligation) filter (
      where a.extent_competed not in (select jsonb_array_elements_text(public.cfg('competition.competed_codes')))
         or a.extent_competed is null) as noncompeted_oblig
  from public.awards a
  where a.uei is not null and a.awarding_sub_agency is not null
    and a.fiscal_year >= public.cfg_num('trend.fy_floor')
  group by a.awarding_sub_agency, a.uei
),
fp as (
  select *, noncompeted_oblig / nullif(total_oblig,0) as nc_share from pair
  where total_oblig > public.cfg_num('scorer.SOLECONC.min_cumulative')
    and noncompeted_oblig / nullif(total_oblig,0) > public.cfg_num('scorer.SOLECONC.max_noncompeted_share')
)
select a.award_unique_id,
  least(100, 60 + 40 * least(1, (fp.nc_share - public.cfg_num('scorer.SOLECONC.max_noncompeted_share'))
                                / (1 - public.cfg_num('scorer.SOLECONC.max_noncompeted_share')))) as subscore,
  jsonb_build_object('sub_agency', fp.awarding_sub_agency, 'noncompeted_share', round(fp.nc_share,3),
    'cumulative_obligation', fp.total_oblig) as inputs
from fp
join public.awards a on a.awarding_sub_agency = fp.awarding_sub_agency and a.uei = fp.uei
where a.fiscal_year >= public.cfg_num('trend.fy_floor');

-- ── 6. COMPCOLLAPSE — competed but exactly one offer; escalate on repetition ──
create or replace view public.score_compcollapse as
with flagged as (
  select a.award_unique_id, a.uei, a.awarding_sub_agency
  from public.awards a
  where a.extent_competed in (select jsonb_array_elements_text(public.cfg('competition.competed_codes')))
    and a.offers_received = public.cfg_num('scorer.COMPCOLLAPSE.offers_equal')
),
reps as (select uei, awarding_sub_agency, count(*) as rep_count from flagged group by uei, awarding_sub_agency)
select f.award_unique_id,
  least(100, 50 + 50 * least(1, (r.rep_count - 1)::numeric
                / nullif(public.cfg_num('scorer.COMPCOLLAPSE.escalate_repetitions') - 1,0))) as subscore,
  jsonb_build_object('offers', 1, 'repetition_count', r.rep_count, 'sub_agency', f.awarding_sub_agency) as inputs
from flagged f join reps r on r.uei = f.uei and r.awarding_sub_agency = f.awarding_sub_agency;

-- ── 7. PRICEOUT — obligation outlier within PSC peer cohort (proxy) ──
create or replace view public.score_priceout as
with psc_stats as (
  select psc, percentile_cont(0.5) within group (order by obligation)::numeric as median_oblig,
    stddev_pop(obligation)::numeric as sd_oblig, count(*) as n
  from public.awards where psc is not null and obligation > 0
  group by psc having count(*) >= public.cfg_num('scorer.PRICEOUT.min_peers')
),
t as (
  select a.award_unique_id, a.psc, a.obligation, s.median_oblig, s.sd_oblig, s.n,
    case when s.sd_oblig > 0 then (a.obligation - s.median_oblig)/s.sd_oblig else 0 end as z
  from public.awards a join psc_stats s on s.psc = a.psc where a.obligation > 0
)
select award_unique_id,
  least(100, 50 + 25 * greatest(0, z - public.cfg_num('scorer.PRICEOUT.stddev_mult'))) as subscore,
  jsonb_build_object('psc', psc, 'obligation', obligation, 'psc_median', round(median_oblig,0),
    'z_score', round(z,2), 'peer_n', n, 'proxy','obligation (no unit price in USAspending)') as inputs
from t
where (z > public.cfg_num('scorer.PRICEOUT.stddev_mult'))
   or (obligation > public.cfg_num('scorer.PRICEOUT.median_mult') * median_oblig);

-- ── 8. FYE — sub-agency books outsized share in last 2 weeks of September ──
create or replace view public.score_fye as
with office_fy as (
  select awarding_sub_agency, fiscal_year, sum(obligation) as total_oblig,
    sum(obligation) filter (where to_char(action_date,'MM-DD') >= (public.cfg('scorer.FYE.late_window_start') #>> '{}')
                              and to_char(action_date,'MM-DD') <= '09-30') as late_oblig
  from public.awards
  where awarding_sub_agency is not null and action_date is not null and obligation is not null
    and fiscal_year >= public.cfg_num('trend.fy_floor')
  group by awarding_sub_agency, fiscal_year
),
fo as (
  select *, late_oblig/nullif(total_oblig,0) as late_share from office_fy
  where late_oblig/nullif(total_oblig,0) > public.cfg_num('scorer.FYE.office_late_share')
)
select a.award_unique_id,
  least(100, 40 + 60 * least(1, (fo.late_share - public.cfg_num('scorer.FYE.office_late_share'))
                                / (1 - public.cfg_num('scorer.FYE.office_late_share')))) as subscore,
  jsonb_build_object('sub_agency', fo.awarding_sub_agency, 'fiscal_year', fo.fiscal_year,
    'office_late_share', round(fo.late_share,3)) as inputs
from fo
join public.awards a on a.awarding_sub_agency = fo.awarding_sub_agency and a.fiscal_year = fo.fiscal_year
  and to_char(a.action_date,'MM-DD') >= (public.cfg('scorer.FYE.late_window_start') #>> '{}')
  and to_char(a.action_date,'MM-DD') <= '09-30';

-- ── 9. GEOMISMATCH — entity state != place-of-performance state ──
create or replace view public.score_geomismatch as
select a.award_unique_id,
  public.cfg_num('scorer.GEOMISMATCH.base_subscore') as subscore,
  jsonb_build_object('entity_state', e.state, 'pop_state', a.place_of_performance_state,
    'note','site-type classification (residential/vacant) needs property records') as inputs
from public.awards a
join public.entities e on e.uei = a.uei
where e.state is not null and a.place_of_performance_state is not null
  and e.state <> a.place_of_performance_state;

-- ── orchestration ──
create or replace function public.run_scoring() returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  truncate public.scores;
  for m in select * from (values
    ('score_nela','NELA'),('score_cluster','CLUSTER'),('score_passthru','PASSTHRU'),
    ('score_modballoon','MODBALLOON'),('score_soleconc','SOLECONC'),('score_compcollapse','COMPCOLLAPSE'),
    ('score_priceout','PRICEOUT'),('score_fye','FYE'),('score_geomismatch','GEOMISMATCH')
  ) as v(view_name, scorer_name) loop
    execute format(
      'insert into public.scores (award_unique_id, scorer_name, subscore, inputs, scored_at)
       select award_unique_id, %L, round(subscore,2), inputs, now() from public.%I where subscore > 0',
      m.scorer_name, m.view_name);
  end loop;
end; $$;

create or replace function public.compute_composite() returns void
language plpgsql security definer set search_path = public as $$
declare w jsonb := public.cfg('composite.weights'); t jsonb := public.cfg('composite.tiers');
begin
  truncate public.composite_scores;
  insert into public.composite_scores (award_unique_id, cas, tier, components, scored_at)
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
  from public.awards a
  left join public.scores s on s.award_unique_id = a.award_unique_id
  group by a.award_unique_id;
end; $$;

create or replace function public.run_all_scoring() returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  perform public.run_scoring();
  perform public.compute_composite();
  select jsonb_build_object(
    'scored_awards', (select count(*) from public.composite_scores),
    'flagged_rows', (select count(*) from public.scores),
    'investigation', (select count(*) from public.composite_scores where tier='investigation'),
    'review', (select count(*) from public.composite_scores where tier='review'),
    'monitor', (select count(*) from public.composite_scores where tier='monitor')
  ) into result;
  return result;
end; $$;
