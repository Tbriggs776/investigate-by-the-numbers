# Investigate by the Numbers
## Government Contracting Anomaly Engine and Verification Standard

**Purpose.** Turn public federal spending data into ranked investigative leads, then
gate every lead through a verification standard before it becomes a story. The engine
finds the smoke. The standard decides whether you publish fire.

**The one principle that governs everything.** The anomaly score is a prioritization
tool. It is never a finding, never a claim, and never appears in a published story as
evidence of wrongdoing. The data points you at a record. Documents and corroboration
make the case.

---

## Data hygiene rules (apply before any scorer runs)
- Use UEI as the primary entity key, not name.
- Normalize and geocode addresses to suite level before clustering.
- Restrict trend analysis to FY2017 and later.
- Treat USAspending figures as a tip, not truth. Reconcile any flagged award against
  the SAM.gov source record before it advances.

---

# PART 1: The Anomaly Engine

Each scorer outputs a normalized subscore 0–100. Subscores roll into one Composite
Anomaly Score (CAS) by weighted sum. **[CONFIG]** thresholds are regulatory constants
that change — store in `config`, confirm against current FAR/SBA rules.

### 1. New-Entity Large Award (NELA) — Weight 18
Detects shell/front companies created to capture a specific award.
Fields: SAM registration_date, action_date, obligation, extent_competed, offers, prior UEI/DUNS.
Logic: flag when (action_date − registration_date) short, obligation large, competition thin.
Thresholds: entity age < 180 days; obligation > $250,000; offers ≤ 1. Escalate sharply above $1M.
Benign: legitimate spinoffs, novations, re-registered firms (check prior UEI/DUNS lineage).

### 2. Address and Officer Clustering (CLUSTER) — Weight 16
Detects bid-rigging rings, straw vendors, set-aside fronts.
Fields: normalized address, registered agent, POCs, UEIs.
Logic: flag when ≥2 distinct UEIs share a suite-level address/agent/officer and ≥2 bid/won in same NAICS or agency.
Thresholds: 2 entities → review; 3+ → investigation weight.
Benign: shared buildings, incubators, registered-agent addresses, parent-subsidiary. Exclude known coworking/agent addresses.

### 3. Set-Aside Pass-Through (PASSTHRU) — Weight 14
Detects a small-biz/8(a)/SDVOSB/WOSB/HUBZone prime winning on status, then routing most work to a large firm.
Fields: type_of_set_aside, prime obligation, subaward amounts and sub-recipient business size.
Logic: flag when subawards to a non-similarly-situated large business exceed the self-performance floor.
Thresholds: FAR limitation on subcontracting — small-biz prime self-performs a minimum share **[CONFIG]** (services: 50%). Pass-through above that to a large sub is a compliance flag.
Benign: legitimate teaming, similarly-situated subs.

### 4. Modification Ballooning (MODBALLOON) — Weight 12
Detects an undersized initial award expanded via mods to evade a competition threshold.
Fields: base_and_all_options_value, current total_obligation, modification history, options.
Logic: flag when current obligation far exceeds original base AND growth came via out-of-scope mods, not priced options.
Thresholds: growth > 3× base via mods; or any single mod crossing the Simplified Acquisition Threshold or another competition trigger **[CONFIG]**.
Benign: exercised options (distinguish from mods), in-scope growth, documented emergency change orders.

### 5. Sole-Source Concentration (SOLECONC) — Weight 12
Detects agency steering/favoritism toward one vendor.
Fields: extent_competed, awarding_sub_agency, recipient_uei, action_date.
Logic: for each agency-vendor pair over a trailing 24 months, flag when non-competed share AND cumulative dollars both run high.
Thresholds: > 75% non-competed and > $1M cumulative.
Benign: valid sole-source justifications (only responsible source, urgency, follow-on). Pull the J&A.

### 6. Competition Collapse (COMPCOLLAPSE) — Weight 8
Detects wired solicitations dressed up as competitive.
Fields: offers, extent_competed, NAICS.
Logic: flag awards marked competed that received exactly one offer; weight up when the same vendor-agency pair repeats.
Thresholds: competed but offers = 1; escalate at 3+ repetitions.
Benign: genuinely niche requirements. Weight rests on repetition.

### 7. Price Outlier (PRICEOUT) — Weight 8
Detects overbilling relative to peers.
Fields: PSC and NAICS, obligation, unit of measure or FTE proxies where available.
Logic: within the same PSC, flag awards whose cost per unit runs far above the peer median.
Thresholds: > 2 standard deviations above peer median, or > 2× the median.
Benign: geography, urgency, spec differences, vehicle type. Weakest standalone; strong corroborator.

### 8. Fiscal Year-End Surge (FYE) — Weight 6
Detects use-it-or-lose-it dumping.
Fields: action_date, obligation, awarding_sub_agency.
Logic: flag offices that book an outsized share of annual obligations in the final weeks of the FY, then flag vendors who capture a disproportionate slice.
Thresholds: office books > 25% of annual dollars in the last two weeks of September; a single vendor takes a disproportionate share.
Benign: year-end spending is partly normal. Context amplifier only.

### 9. Geographic Mismatch (GEOMISMATCH) — Weight 6
Detects ghost vendors and place-of-performance fraud.
Fields: recipient address vs place_of_performance; site classification.
Logic: flag when the place of performance is residential, a vacant lot, or implausibly distant from any facility the vendor could operate.
Thresholds: site-type mismatch confirmed by property records.
Benign: legitimate home-based/remote work, services delivered on government sites.

---

## Composite Anomaly Score (CAS)
Weighted sum of subscores, normalized 0–100.
Weights: NELA 18, CLUSTER 16, PASSTHRU 14, MODBALLOON 12, SOLECONC 12, COMPCOLLAPSE 8, PRICEOUT 8, FYE 6, GEOMISMATCH 6.
Tiers: 0–39 Monitor (no action); 40–69 Review (analyst eyeballs); 70–100 Investigation candidate (enters the verification gate).
**Hard rule.** A high CAS earns a place in the queue. It earns nothing in print.
**Calibration.** Backtest against already-prosecuted cases before trusting a live flag.

---

# PART 2: The Verification Standard (human-only gates)
Every investigation candidate clears these in order; fail one and it goes back to the queue or dies.

- **Gate 0 — Data Integrity.** Re-pull from SAM source; rule out artifact (dup, miskey, lag, wrong FY); confirm FY2017+.
- **Gate 1 — Entity Resolution.** Resolve UEI to legal entity, owners, officers; SAM history + prior UEI/DUNS; verify address by geocode + site check.
- **Gate 2 — The Steelman.** Write the strongest innocent explanation per flag, then get the primary document that confirms or kills it. The gate that keeps you out of court.
- **Gate 3 — Independent Corroboration.** ≥2 independent sources beyond the score (the score is not a source). Log provenance.
- **Gate 4 — Right of Reply.** Contact vendor + agency with specific, document-anchored questions. Ask, don't accuse. Record verbatim.
- **Gate 5 — Legal & Harm Review.** Mandatory libel read. "The records show," never "this is fraud." Tie to specific actors + dollars, never to a community.
- **Gate 6 — Publication Standard.** Tag each claim confirmed/disputed/unverified; link primary docs; corrections ready. Do not publish unconfirmed identities or anything resting on the score alone.

**Decision rule:** Publish (all gates cleared) · Hold (a gate unmet — not a failure) · Kill (benign explanation held or data was an artifact — a win for the brand).

---

*Thresholds marked [CONFIG] are live regulatory values to be confirmed, not constants.
Backtest before trusting. Verify before you publish.*
