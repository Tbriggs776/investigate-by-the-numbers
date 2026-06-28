# Open Decisions

Decisions surfaced by the Phase 0 schema review that depend on the methodology
document or on choices the editor/owner must make. Captured here so they are not
rediscovered painfully at Phase 3. Each has a status.

## Blocks a scorer

### 1. PRICEOUT has no data source — OPEN (methodology)
USAspending / FPDS award records carry **no line-item unit pricing** (not even in
`raw_awards.raw`). "Std deviations above peer unit price" is undeliverable as
written. Decide one of:
- **(a) Redefine** PRICEOUT to a derivable proxy: obligation normalized by
  NAICS/PSC peer cohort, or $ per period-of-performance day. (No new storage.)
- **(b) Add a source**: contract PDFs via the Document agent, or GSA CALC labor
  rates for services NAICS like the 541512 slice. Requires a `line_items` child
  table (award_unique_id, description, quantity, unit_of_measure, unit_price,
  extended_price, source).

Must be settled before Phase 1 field-mapping locks if (b).

## Scorer definition details (methodology, before Phase 3)

### 2. Peer-cohort dimension — OPEN
For PRICEOUT / SOLECONC / COMPCOLLAPSE: peer by **NAICS** (broad) or **PSC**
(narrow)? Materially changes results. Record the cohort key + cohort size `n` in
`scores.inputs`.

### 3. SOLECONC denominator granularity — OPEN
Office-level (now captured: `awarding_office_code`) vs sub-agency. Methodology picks.

### 4. PASSTHRU denominator + subaward coverage — OPEN
Denominator: `obligation` vs `base_value` vs `current_total_value`. Subaward
amounts (FSRS) and prime amounts (FPDS) come from different feeds and often don't
reconcile; `subawards.prime_award_unique_key` (added in 0010) is stored to reconcile.

**Coverage:** `ingest-subawards` currently uses the slice-filtered subaward feed,
which only returns subawards whose *subaward* action falls in the slice window AND
whose prime is in `awards` (others are skipped to respect the FK — on the dev slice
that skipped 531/544, leaving 10 across 6 primes). For full PASSTHRU coverage of our
primes, switch to a **per-prime** fetch (POST `/api/v2/subawards/` per
`award_unique_id`) so every subaward of every held prime is captured regardless of
subaward date. Do this when PASSTHRU is built.

### 5. MODBALLOON ingest grain — OPEN (scorer DISABLED until resolved)
Ingest each modification as its own `awards` row (needed for the timeline + the
Document agent), or only the latest snapshot? `awards` is **summary-grain** today.
If per-action detail is needed, add a `transactions` table at transaction grain —
do not re-derive sums from repeated upserts. `base_award_unique_key` (added in
0010) is the grouping key.

**The MODBALLOON scorer is DISABLED (migration 0016).** The adversarial scorer
review found that at summary grain `current_total_value / base_value` =
`base_and_all_options / base_exercised_options` = **unexercised priced options** —
which is the methodology's explicit *benign* case, the inverse of mod-driven
ballooning. True MODBALLOON needs transaction-grain mod history + the original base
value, neither of which summary grain provides. Re-enable once this is ingested.

### 6. NELA missing-registration handling — OPEN
How is an un-enriched / deregistered entity (no `registration_date`) treated —
unknown vs flagged? Default must not silently score a new-entity detector as 0.
Read `initial_registration_date` (added in 0010), not the renewable date.

## Scope choices (owner)

### 7. Sub-recipient entity resolution — DECIDED (v1: out of scope)
`subawards.sub_recipient_uei` stays bare text in v1 (no FK to `entities`, no stub).
Sub-tier pass-through / cluster traversal is deferred. Revisit if PASSTHRU/CLUSTER
need the sub tier.

### 8. Set-aside vs socioeconomic reconciliation — OPEN
Comparing `awards.set_aside_type` (FPDS freetext) against `entities.socioeconomic`
(jsonb) needs a defined key schema (e.g. `{is_8a, is_sdvosb, is_wosb, is_hubzone}`)
before Phase 2 populates it. Not assigned to any named scorer yet — decide if it's
in scope.

## Deferred hardening (note, safe to defer)

### 9. Reproducibility — DEFERRED to Phase 3/4
Add `scores.scorer_version` + capture the exact `config` thresholds used into
`scores.inputs` (and `composite.weights`/`tiers` into `composite_scores.components`).
Critical for the Phase 6 backtest (attribute score changes to weights vs data).

### 10. CHECK bounds on `scores.subscore` / `composite_scores.cas` — DEFERRED
Add once the methodology fixes the scale (config assumes a 0–100 CAS space).

### 11. Aggregate columns use unbounded `numeric` — DEFERRED to Phase 3/4
Per-award `numeric(18,2)` is correct. Any SUM()/rollup/composite-math column must
be unbounded `numeric` to avoid overflow (22003) on wide aggregates.

### 12. CLUSTER niceties — DEFERRED
`address_exclusions.pattern` column (distinct from `address_normalized`), an
`entities(zip)` index for zip-level clustering, and reserved shared-registered-agent
fields (Wave 2 Dossier dimension).

### 13. NAICS/PSC reference tables — DEFERRED (optional)
`*_description` columns on `awards` are convenience denormalizations; the **code**
is the only join/group key. Optionally normalize to `naics_code→description` /
`psc_code→description` reference tables.
