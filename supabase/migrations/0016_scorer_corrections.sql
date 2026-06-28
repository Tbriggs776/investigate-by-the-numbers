-- Migration 0016: scorer corrections from the adversarial review.
-- Fixes correctness bugs that mis-score/mis-prioritize leads, adds missing
-- benign-explanation notes, normalizes string comparisons. Views recreated with
-- security_invoker = on (preserve 0015 hardening).

-- new config keys
insert into public.config (key, value, description) values
  ('scorer.PASSTHRU.qualifying_set_aside_codes',
   '["SBA","8A","8AN","SDVOSBC","SDVOSBS","WOSB","WOSBSS","EDWOSB","EDWOSBSS","HZC","HZS"]'::jsonb,
   'FPDS type_set_aside codes that qualify a prime as a small-biz/8(a)/SDVOSB/WOSB/HUBZone set-aside. Excludes NONE / full-and-open.'),
  ('scorer.SOLECONC.min_awards', '2'::jsonb,
   'Minimum award count for a (sub_agency, vendor) pair to count as a concentration pattern (a single award is not concentration).'),
  ('scorer.FYE.min_annual_oblig', '1000000'::jsonb,
   'Minimum sub-agency/FY total obligations for the year-end-share test to be meaningful (guards thin denominators).')
on conflict (key) do update set value = excluded.value, description = excluded.description, updated_at = now();

-- ── MODBALLOON: DISABLED (honest) ──
-- True mod ballooning needs transaction-grain modification history + the ORIGINAL
-- base value. At summary grain we have neither: current_total_value/base_value =
-- base_and_all_options/base_exercised_options = UNEXERCISED PRICED OPTIONS, which is
-- the methodology's explicit BENIGN case. Emitting that ratio inverts the scorer.
-- Re-enable when transaction-grain ingest lands (open-decisions #5).
create or replace view public.score_modballoon with (security_invoker = on) as
select award_unique_id, 0::numeric as subscore, '{}'::jsonb as inputs
from public.awards where false;

-- ── PASSTHRU: restrict to qualifying set-aside codes; denominator caveat ──
create or replace view public.score_passthru with (security_invoker = on) as
with sub as (select parent_award_id, sum(amount) as sub_total from public.subawards group by parent_award_id),
t as (
  select a.award_unique_id, a.set_aside_type, a.obligation, sub.sub_total,
    sub.sub_total / nullif(a.obligation,0) as passthrough_ratio
  from public.awards a
  join sub on sub.parent_award_id = a.award_unique_id
  where a.obligation > 0
    and upper(trim(a.set_aside_type)) in (select upper(jsonb_array_elements_text(public.cfg('scorer.PASSTHRU.qualifying_set_aside_codes'))))
)
select award_unique_id,
  least(100, 50 + 100 * greatest(0, passthrough_ratio - (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor')))) as subscore,
  jsonb_build_object('set_aside_type', set_aside_type, 'subaward_total', sub_total, 'obligation', obligation,
    'passthrough_ratio', round(passthrough_ratio,3),
    'note','sub business size not captured (large-sub unconfirmed); FSRS subaward $ vs FPDS obligation may not reconcile (ratio can exceed 1); subaward coverage is partial on the dev slice') as inputs
from t
where passthrough_ratio > (1 - public.cfg_num('scorer.PASSTHRU.self_perform_floor'));

-- ── COMPCOLLAPSE: NOT NULL guards, FY window, real offers, benign note, normalized codes ──
create or replace view public.score_compcollapse with (security_invoker = on) as
with flagged as (
  select a.award_unique_id, a.uei, a.awarding_sub_agency, a.offers_received
  from public.awards a
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

-- ── PRICEOUT: mean-centered z-score; median-multiple branch carries severity; caveats ──
create or replace view public.score_priceout with (security_invoker = on) as
with psc_stats as (
  select psc, avg(obligation)::numeric as mean_oblig,
    percentile_cont(0.5) within group (order by obligation)::numeric as median_oblig,
    stddev_pop(obligation)::numeric as sd_oblig, count(*) as n
  from public.awards where psc is not null and obligation > 0
  group by psc having count(*) >= public.cfg_num('scorer.PRICEOUT.min_peers')
),
t as (
  select a.award_unique_id, a.psc, a.obligation, s.mean_oblig, s.median_oblig, s.sd_oblig, s.n,
    case when s.sd_oblig > 0 then (a.obligation - s.mean_oblig)/s.sd_oblig else 0 end as z,
    a.obligation / nullif(s.median_oblig,0) as median_mult_ratio
  from public.awards a join psc_stats s on s.psc = a.psc where a.obligation > 0
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

-- ── SOLECONC: min award count guard; benign note; null-noncompeted disclosure ──
create or replace view public.score_soleconc with (security_invoker = on) as
with pair as (
  select a.awarding_sub_agency, a.uei,
    count(*) as award_count,
    sum(a.obligation) as total_oblig,
    sum(a.obligation) filter (
      where upper(trim(a.extent_competed)) not in (select upper(jsonb_array_elements_text(public.cfg('competition.competed_codes'))))
         or a.extent_competed is null) as noncompeted_oblig
  from public.awards a
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
    'note','null extent_competed counted as non-competed (may be missing/summary data); benign: valid J&A (only responsible source, urgency, follow-on) — pull the J&A; window is FY2017+ on summary grain') as inputs
from fp
join public.awards a on a.awarding_sub_agency = fp.awarding_sub_agency and a.uei = fp.uei
where a.fiscal_year >= public.cfg_num('trend.fy_floor');

-- ── FYE: min-denominator guard; benign + grain note ──
create or replace view public.score_fye with (security_invoker = on) as
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
  where total_oblig >= public.cfg_num('scorer.FYE.min_annual_oblig')
    and late_oblig/nullif(total_oblig,0) > public.cfg_num('scorer.FYE.office_late_share')
)
select a.award_unique_id,
  least(100, 40 + 60 * least(1, (fo.late_share - public.cfg_num('scorer.FYE.office_late_share'))
                                / (1 - public.cfg_num('scorer.FYE.office_late_share')))) as subscore,
  jsonb_build_object('sub_agency', fo.awarding_sub_agency, 'fiscal_year', fo.fiscal_year,
    'office_late_share', round(fo.late_share,3), 'annual_obligation', fo.total_oblig,
    'note','year-end spending is partly normal — context amplifier only; grain is sub-agency (not office) and counts base awards SIGNED in the window, not all FY obligations; vendor-share prong deferred') as inputs
from fo
join public.awards a on a.awarding_sub_agency = fo.awarding_sub_agency and a.fiscal_year = fo.fiscal_year
  and to_char(a.action_date,'MM-DD') >= (public.cfg('scorer.FYE.late_window_start') #>> '{}')
  and to_char(a.action_date,'MM-DD') <= '09-30';

-- ── GEOMISMATCH: normalize state comparison; honest benign note ──
create or replace view public.score_geomismatch with (security_invoker = on) as
select a.award_unique_id,
  public.cfg_num('scorer.GEOMISMATCH.base_subscore') as subscore,
  jsonb_build_object('entity_state', e.state, 'pop_state', a.place_of_performance_state,
    'note','state-level proxy only; for a services NAICS a state mismatch is EXPECTED-BENIGN (remote/distributed work, delivery on government sites). Real site-type (residential/vacant) needs property records. Unenriched entities (null state) are excluded, so absence of a flag is not evidence of plausibility.') as inputs
from public.awards a
join public.entities e on e.uei = a.uei
where e.state is not null and a.place_of_performance_state is not null
  and upper(trim(e.state)) <> upper(trim(a.place_of_performance_state));
