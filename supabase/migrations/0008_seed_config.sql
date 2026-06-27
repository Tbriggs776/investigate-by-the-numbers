-- Migration 0008: seed config (structural keys + PLACEHOLDER thresholds) + test slice.
-- PLACEHOLDER values reserve the config slot and document intent ONLY. The real
-- definitions + numbers come from the methodology document at Phase 3/4. Do not
-- treat any PLACEHOLDER as a confirmed regulatory rule.

insert into public.config (key, value, description) values
  ('trend.fy_floor', '2017'::jsonb,
   'Earliest fiscal year included in trend logic. Confirmed.'),

  ('test_slice', '{"agency":"Department of Veterans Affairs","naics":"541512","fiscal_year":2023}'::jsonb,
   'Dev slice to keep volumes small (Phase 0). One agency + one NAICS + one FY.'),

  ('composite.weights',
   '{"NELA":0.11,"CLUSTER":0.11,"SOLECONC":0.11,"COMPCOLLAPSE":0.11,"MODBALLOON":0.11,"PASSTHRU":0.11,"FYE":0.11,"PRICEOUT":0.12,"GEOMISMATCH":0.11}'::jsonb,
   'PLACEHOLDER equal-ish weights. Replace from methodology at Phase 4.'),

  ('composite.tiers', '{"monitor":[0,40],"review":[40,70],"investigation":[70,100]}'::jsonb,
   'PLACEHOLDER CAS tier cutoffs. Replace from methodology at Phase 4.'),

  ('scorer.NELA.new_entity_days', '365'::jsonb,
   'PLACEHOLDER structure only: entity registered fewer than N days before award action_date. Define + value from methodology.'),
  ('scorer.CLUSTER.min_entities', '3'::jsonb,
   'PLACEHOLDER structure only: shared-address cluster size that flags. Define + value from methodology.'),
  ('scorer.SOLECONC.min_share', '0.80'::jsonb,
   'PLACEHOLDER structure only: vendor share of an office''s obligations in a NAICS. Define + value from methodology.'),
  ('scorer.COMPCOLLAPSE.max_offers', '1'::jsonb,
   'PLACEHOLDER structure only: offers_received at/below which competition is treated as collapsed. Define + value from methodology.'),
  ('scorer.MODBALLOON.growth_pct', '0.50'::jsonb,
   'PLACEHOLDER structure only: modification growth over base_value that flags. Define + value from methodology.'),
  ('scorer.PASSTHRU.min_subaward_share', '0.70'::jsonb,
   'PLACEHOLDER structure only: share of award passed to subawardees. Define + value from methodology.'),
  ('scorer.FYE.window_days', '30'::jsonb,
   'PLACEHOLDER structure only: award action within N days of fiscal year end. Define + value from methodology.'),
  ('scorer.PRICEOUT.deviation', '2.0'::jsonb,
   'PLACEHOLDER structure only: standard deviations above peer unit price. Define + value from methodology.'),
  ('scorer.GEOMISMATCH.enabled', 'true'::jsonb,
   'PLACEHOLDER structure only: flag when place-of-performance state != entity state. Define from methodology.')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();
