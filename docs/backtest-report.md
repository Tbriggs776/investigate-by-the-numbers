# Phase 6 — Backtest Calibration Report

**Question this answers (methodology Part 1, "Calibration"):** *Run the engine
backward against already-prosecuted federal contracting cases — do they score in
the investigation tier?* The methodology is explicit that **a live flag is not to
be trusted until this passes.**

**Headline result: they do not — yet.** On this first pass, prosecuted-fraud
contracts scored no higher than a clean control slice (max CAS **19.14** vs the
clean VA/541512 slice's **19.00**); **zero of 453 real fraud-vendor awards reached
the Review (40) or Investigation (70) tier.** The backtest's value is in *why*, and
it is precise and fixable — see Findings.

> This is the intended function of a calibration gate. It is better to learn here,
> against cases that are already a matter of public record, that the engine — as
> currently fed and weighted — would not have surfaced them, than to trust a live
> flag that hasn't earned it.

---

## Method

- **Isolated harness (migration 0017).** A `backtest` schema mirrors the **exact**
  production engine (the nine `score_*` views + composite/tiering from 0014+0016),
  with the data tables swapped to `backtest.*` and `config`/`cfg()`/thresholds kept
  **shared** with production. Proven faithful: re-scoring the live 157-award
  population through the mirror reproduced production CAS **157/157, zero diff**.
  The backtest never touches the live leads (the dashboard reads `public` only).
- **Case set — real, cited, adversarially verified.** A research pass over 12
  fraud categories produced 69 candidate prosecuted cases; an adversarial verifier
  re-fetched every citation (DOJ / agency OIG / GAO / court). **68 confirmed, 0
  rejected, 1 uncertain.** Deduped to **38 unique cases** (31 award-data-scorable,
  7 structural blind-spots). Three citations were additionally spot-checked by hand
  against primary sources (ADS/Hillier→GSA-OIG, Intellipeak→IRS-CI, Burke→trial
  record) and matched exactly. **No case or vendor was invented.**
- **Real award retrieval.** For each scorable vendor, actual award records were
  pulled from the **USAspending API** (search → award detail), mapping the FPDS
  fields the scorers read. Recovered **453 real awards across 32 vendors**
  (31/55 case-rows; capped at 20 awards/vendor by obligation). Where a vendor's
  awards were not cleanly retrievable (people-named conspirators, joint ventures,
  pre-2008 records) the case was left unscored rather than fabricated.

---

## What scored

| | |
|---|---|
| Real fraud-vendor awards scored | 453 |
| Distinct vendors | 32 |
| Scorer hits fired (`backtest.scores`) | 288 |
| **Investigation tier (CAS ≥ 70)** | **0** |
| **Review tier (CAS ≥ 40)** | **0** |
| Monitor tier | 453 |
| Max CAS / mean CAS | **19.14** / 2.46 |

**Per-scorer firing on prosecuted vendors:**

| Scorer | Weight | Fires | Avg subscore | Read |
|---|---|---|---|---|
| GEOMISMATCH | 6 | 213 | 50 (flat) | High-frequency, low-value — fires on almost every services vendor (remote work = expected-benign). Noise. |
| PRICEOUT | 8 | 39 | 80 | **Fires strongly** where peer cohorts exist. |
| COMPCOLLAPSE | 8 | 18 | 86 | **Fires strongly** — competition collapse *is* detected. (61 with the FY floor lowered.) |
| FYE | 6 | 15 | 86 | **Spurious here** — a vendor-only population has no real agency-wide denominator. |
| CLUSTER | 16 | 2 | 50 | Starved — only primary vendors retrieved, so rings collapse to 1–2 entities. |
| PASSTHRU | 14 | 1 | 74 | Starved — see below. |
| NELA | 18 | 0 | — | Dark — see below. |
| SOLECONC | 12 | 0 | — | Floor-gated — see below (35 with the floor lowered). |
| MODBALLOON | 12 | 0 | — | Disabled by design (0016). |

The scorers that **had their designed inputs** (COMPCOLLAPSE, PRICEOUT) fired hard
on fraud vendors. The composite never reached Review because the rest didn't — and
that has three identifiable causes.

---

## Findings (the diagnosis)

### 1. The FY2017 trend floor blinds the trend scorers to most prosecuted fraud
**373 of 453 awards (82%) are pre-FY2017** (range 2003–2025). `config.trend.fy_floor`
(= 2017) gates SOLECONC, COMPCOLLAPSE, and FYE off all of them. Prosecuted cases are,
almost by definition, *old by the time they are charged*; the engine's trend logic
only looks forward from FY2017.

A self-restoring what-if (floor → 2008, **backtest only**, production config restored
to 2017 immediately) confirms the gate is the cause:

| Scorer | floor 2017 | floor 2008 |
|---|---|---|
| SOLECONC | 0 | **35** |
| COMPCOLLAPSE | 18 | **61** |
| FYE | 15 | 82 |
| **Max CAS** | **19.14** | **20.34** |
| Reached Review (40) | 0 | 0 |

The floor is a real suppressor — **but lowering it alone moves the max CAS by ~1
point and still surfaces nothing.** The floor is necessary, not sufficient.

### 2. The three highest-weight scorers (48% of total weight) were starved of data
- **NELA (weight 18): 0 fires.** Needs the vendor's SAM *initial registration date*.
  USAspending award detail does not carry it, and SAM enrichment is daily-quota-limited.
  **Every NELA case (Aventura, ADS, Odyssey, Zieson) scored NELA = 0.**
- **PASSTHRU (weight 14): 1 fire.** Needs FSRS subaward totals. **256 of 453 awards
  are qualifying set-asides — but only 9 carried a subaward amount** from the
  prime-detail feed. PASSTHRU is the single most common case dimension (37 cases)
  and is almost entirely unfed. A per-prime FSRS subaward pull (open-decisions #4)
  is the highest-ROI fix.
- **CLUSTER (weight 16): 2 fires.** Needs every member of a shell/front *ring* and
  their addresses. Only the primary vendor per case was retrieved, so rings
  collapsed.

Three scorers carrying nearly half the weight contributed essentially nothing — not
because their logic is wrong, but because the inputs the methodology assumes
(SAM enrichment, FSRS subawards, full entity resolution) were not supplied to the
backtest.

### 3. Per-award CAS dilutes a vendor-level signal
Fraud is a property of a *vendor / scheme*, but CAS is computed **per award**.
Ross Group trips **4 distinct scorers** across its 20 awards (COMPCOLLAPSE, FYE,
GEOMISMATCH, PRICEOUT) yet no single award exceeds 19, because the per-award scorers
(COMPCOLLAPSE, PRICEOUT, GEOMISMATCH) rarely coincide on the *same* award while the
aggregate ones (SOLECONC, FYE) attach to all of them. A vendor whose award *portfolio*
is plainly anomalous never accumulates a high score on any one row.

### 4. GEOMISMATCH is high-frequency, low-value noise
213 of 288 hits (74%) are GEOMISMATCH at a flat 50 — and for a services NAICS a
state mismatch is expected-benign (the methodology already flags it as the weakest
scorer). It mostly adds a constant +3 CAS to everything, separating nothing.

---

## Recommended tuning (prioritized)

1. **Feed the starved high-weight scorers before re-judging the engine.** This is
   the dominant lever. (a) **PASSTHRU** — add per-prime FSRS subaward retrieval
   (open-decisions #4); 256 set-aside awards are waiting. (b) **NELA** — supply SAM
   `initial_registration_date` (Phase-2 enrichment for the backtest entities).
   (c) **CLUSTER** — retrieve full co-conspirator entity sets.
2. **Make the FY floor per-scorer, or detection-vs-trend aware.** A single global
   `trend.fy_floor` = 2017 both defines "recent enough to act on" *and* silently
   blinds detection to long-running/older schemes. Split them, or lower the
   detection floor and keep a separate recency filter for the live queue.
3. **Add a vendor/entity-level rollup score.** Aggregate a vendor's award CAS
   (e.g. max, or a distinct-scorers-fired bonus, or a decayed sum) so an anomalous
   *portfolio* surfaces even when no single award is extreme. This is likely the
   biggest single accuracy gain and directly addresses Finding 3.
4. **Down-weight or gate GEOMISMATCH** (e.g. require a non-services NAICS, or treat
   it as a tie-breaker, not a contributor).
5. **Exclude FYE from vendor-only backtests** (it needs full agency spend to have a
   valid denominator) and re-confirm it on a population-complete slice.
6. **Re-tune the 40/70 thresholds only after 1–3.** Lowering thresholds now would
   raise the clean-slice false-positive rate just as much (the clean slice also
   tops out near 19); the gap to close is signal, not threshold.

---

## Honest limitations of this backtest

- **It partly tests the engine outside its design envelope.** The engine targets
  recent (FY2017+), SAM-enriched, subaward-resolved contracts; most prosecuted
  cases are older and were scored without SAM/FSRS enrichment. The fair within-design
  subset (post-2017, COMPCOLLAPSE/PRICEOUT) is where it performed best.
- **Cohort-relative scorers (PRICEOUT) are weak in a fraud-only population** — peer
  PSC cohorts are thin. A population-complete backtest (fraud vendors embedded in a
  full agency/PSC slice) would test them properly.
- **31/55 case-rows retrieved.** People-named conspirators, joint ventures, and
  pre-2008 records did not resolve to a clean USAspending recipient; those cases are
  unscored, not fabricated.
- **13 cases are structural blind-spots** (defective pricing / TINA, labor
  mischarging, counterfeit parts, kickbacks) — fraud that lives in performance and
  invoicing, not award-level data. The engine cannot and should not be expected to
  catch them; counting them honestly is part of the denominator.

## Bottom line

The scorers **detect** fraud patterns (COMPCOLLAPSE and PRICEOUT fired at 80–86 avg
on real prosecuted vendors), but the engine **as currently fed and composed would
not have surfaced these cases into the Investigation tier.** Do not trust a live
investigation-tier flag until the high-weight scorers are fed (PASSTHRU/NELA/CLUSTER),
the FY floor is reworked for detection, and a vendor-level rollup is added — then
re-run this backtest. That is the calibration gate doing its job.

---

*Reproducibility: the verified case set lives in `backtest.cases`; the harness and
mirrored engine in migration 0017; this run's scores in `backtest.scores` /
`backtest.composite_scores` (production `config` unchanged). The what-if in Finding 1
restores `trend.fy_floor` to its original value within the same transaction.*
