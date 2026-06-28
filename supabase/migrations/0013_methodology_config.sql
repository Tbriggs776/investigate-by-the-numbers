-- Migration 0013: replace Phase-0 placeholder config with the real methodology
-- weights, tiers, and [CONFIG] thresholds (Part 1 of the methodology).

insert into public.config (key, value, description) values
  -- CAS composite (methodology weights sum to 100; tiers 0-39 / 40-69 / 70-100)
  ('composite.weights',
   '{"NELA":18,"CLUSTER":16,"PASSTHRU":14,"MODBALLOON":12,"SOLECONC":12,"COMPCOLLAPSE":8,"PRICEOUT":8,"FYE":6,"GEOMISMATCH":6}'::jsonb,
   'CAS weights from the methodology. CAS = sum(weight*subscore)/100.'),
  ('composite.tiers',
   '{"monitor":[0,40],"review":[40,70],"investigation":[70,101]}'::jsonb,
   'Half-open CAS tier bands: monitor 0-39, review 40-69, investigation 70-100.'),

  -- shared: which extent_competed codes count as genuinely competed
  ('competition.competed_codes', '["A","D","F","CDO"]'::jsonb,
   'FPDS extent_competed codes treated as competed (A full&open, D full&open after exclusion, F competed under SAP, CDO competitive delivery order). Everything else = non-competed.'),

  -- 1. NELA
  ('scorer.NELA.max_age_days', '180'::jsonb, 'Entity age (action_date - initial SAM registration) below which it is "new".'),
  ('scorer.NELA.min_obligation', '250000'::jsonb, 'Obligation floor to flag.'),
  ('scorer.NELA.max_offers', '1'::jsonb, 'Offers received at or below this = thin competition.'),
  ('scorer.NELA.escalate_obligation', '1000000'::jsonb, 'Obligation at which the subscore reaches 100.'),

  -- 2. CLUSTER
  ('scorer.CLUSTER.review_size', '2'::jsonb, 'Distinct UEIs at one suite-level address that triggers review.'),
  ('scorer.CLUSTER.investigation_size', '3'::jsonb, 'Cluster size that triggers investigation weight.'),

  -- 3. PASSTHRU
  ('scorer.PASSTHRU.self_perform_floor', '0.50'::jsonb, 'FAR services limitation-on-subcontracting: small-biz prime self-performs >= this share, so pass-through above (1 - floor) flags.'),

  -- 4. MODBALLOON
  ('scorer.MODBALLOON.growth_multiple', '3.0'::jsonb, 'current_total_value / base_value above this = ballooned.'),

  -- 5. SOLECONC
  ('scorer.SOLECONC.max_noncompeted_share', '0.75'::jsonb, 'Non-competed share of a sub-agency/vendor pair''s obligations that flags.'),
  ('scorer.SOLECONC.min_cumulative', '1000000'::jsonb, 'Cumulative obligations floor for the pair.'),
  ('scorer.SOLECONC.window_months', '24'::jsonb, 'Trailing window for live operation (computed over loaded data in dev).'),

  -- 6. COMPCOLLAPSE
  ('scorer.COMPCOLLAPSE.offers_equal', '1'::jsonb, 'Competed award with exactly this many offers = collapse.'),
  ('scorer.COMPCOLLAPSE.escalate_repetitions', '3'::jsonb, 'Repetitions by a vendor-agency pair at which subscore reaches 100.'),

  -- 7. PRICEOUT
  ('scorer.PRICEOUT.stddev_mult', '2.0'::jsonb, 'Std deviations above PSC peer median that flags.'),
  ('scorer.PRICEOUT.median_mult', '2.0'::jsonb, 'Multiple of PSC peer median that flags.'),
  ('scorer.PRICEOUT.min_peers', '5'::jsonb, 'Minimum PSC peer count for a stable cohort (else skip).'),

  -- 8. FYE
  ('scorer.FYE.office_late_share', '0.25'::jsonb, 'Share of a sub-agency/FY obligations in the last 2 weeks of Sept that flags the office.'),
  ('scorer.FYE.late_window_start', '"09-17"'::jsonb, 'Start (MM-DD) of the year-end window; through 09-30.'),

  -- 9. GEOMISMATCH (Phase-3 derivable signal: state-level mismatch; site-type needs property records)
  ('scorer.GEOMISMATCH.base_subscore', '50'::jsonb, 'Subscore for a confirmed entity-state vs place-of-performance-state mismatch (weak/corroborator).')
on conflict (key) do update
  set value = excluded.value, description = excluded.description, updated_at = now();
