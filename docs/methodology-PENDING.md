# Methodology — PENDING

> **This file is a placeholder.** The real methodology document
> (`investigate-by-the-numbers-govcon-methodology.md`) has not been added yet.

The build brief and agent architecture both defer to the methodology as the
source of truth for:

- The nine scorers (NELA, CLUSTER, SOLECONC, COMPCOLLAPSE, MODBALLOON, PASSTHRU,
  FYE, PRICEOUT, GEOMISMATCH) — their exact definitions and logic.
- The numeric thresholds for each scorer (currently seeded as **PLACEHOLDER**
  values in the `config` table — see migration `0008_seed_config.sql`).
- The composite weighting and tier cutoffs.
- The verification gates and standard the `case_files` workflow enforces.

## Hard rule

**Phase 3 (the scorers) does not start until this file is replaced with the real
methodology.** We do not invent scoring logic or thresholds. Phases 0–2 (scaffold,
ingestion, entity resolution) do not depend on it and can proceed.

To unblock: drop the methodology document in this folder (replacing this file)
and the `config` placeholder values can be reconciled to the confirmed numbers.
