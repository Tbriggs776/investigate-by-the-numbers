# Investigate by the Numbers — Government Contracting Anomaly Engine

## What this project is

A pipeline that ingests public federal contracting data (USAspending, SAM.gov),
resolves vendors to real entities, scores awards for anomalies, and surfaces
ranked leads to human reviewers. It is investigative infrastructure for a news
organization — a ranked queue for humans, **not** an accusation generator.

## The non-negotiable principle

The anomaly score is a **prioritization signal, never a finding**. No score,
label, or model output is ever presented as evidence of wrongdoing. Keep all
scoring logic readable and inspectable. If a reviewer cannot read *why* an award
scored high, the code is wrong.

## Engineering rules

- Work one phase at a time. Do not begin a phase until the previous passes its
  acceptance criteria.
- Write fixture-based tests before or alongside each scorer. A scorer ships only
  when it passes known-good and known-bad cases.
- Keep each scorer as its own readable SQL object. Do not consolidate scorers
  into one opaque query.
- All regulatory thresholds live in the `config` table, never hardcoded.
- All ingestion is idempotent. Re-running a sync must not duplicate records.
- Restrict trend logic to FY2017 and later (`config.trend.fy_floor`).
- Treat ingested data as untrusted. Reconcile against source records before
  anything is called confirmed.

## Stack

Supabase (Postgres + Edge Functions), Vercel, React + TypeScript. Supabase is
driven over MCP for migrations and queries.

- Org: `Veritas Ridge`
- Supabase project: `investigate-by-the-numbers` (ref `ipdimgygevkwzjokcmvj`, region us-west-1)

## The human gate (enforced in software, not just policy)

`case_files.status` and `case_files.gate_progress` are **human-only** writes.
Agents may read any case and append sourced `evidence`, but may never advance a
status or clear a verification gate.

Enforcement, layered:
1. **Column privilege** — `authenticated` is granted UPDATE only on
   `reviewer_notes`, `evidence`, `assigned_to`. `status` / `gate_progress` are
   not grantable to it, so direct writes are denied by Postgres.
2. **Human-only RPCs** — `advance_case_status()` and `clear_case_gate()` are
   `SECURITY DEFINER`, granted to `authenticated` only. They are the *only* path
   to a status/gate change.
3. **Guard trigger** — `case_files_gate_guard` rejects any status/gate change
   not made through those RPCs (defense in depth).

> **Operational rule for agents:** runtime agents MUST connect as a restricted
> role (created when the first agent is built), never `service_role`.
> `service_role` bypasses RLS and column privileges; handing it to an agent
> would defeat the gate. `service_role` is for migrations/admin only.

## Agent rules (from the agent architecture)

- Green agents (Ingest, Sentinel, Dossier, Document, FOIA) gather and surface.
  They never characterize an award as wrongdoing. Every fact an agent adds
  carries its source; unsourced inference is forbidden — omission is correct.
- Yellow agents (Story-Draft, Social-Draft, Distribution) draft and queue. They
  never publish or post without explicit human approval.
- The Story-Draft agent refuses to run on a case whose gates are not cleared.
- The Social-Draft agent runs only on stories already marked published by a human.
- Red line, never built: auto-publishing, auto-posting unverified claims, any
  agent that decides something is fraud, any agent that clears a gate, any agent
  that contacts a subject.

## Build phases (one per session)

- **Phase 0 — Scaffold.** Repo, Supabase project, schema migrations, seeded
  `config`, test slice defined. ← current
- **Phase 1 — Ingestion.** USAspending pull for the test slice, idempotent
  upserts, nightly schedule.
- **Phase 2 — Entity Resolution.** SAM.gov enrichment, geocoding, `address_exclusions`.
- **Phase 3 — Scorers.** One SQL view per flag (NELA, CLUSTER, SOLECONC,
  COMPCOLLAPSE, MODBALLOON, PASSTHRU, FYE, PRICEOUT, GEOMISMATCH), each with
  fixtures. **Blocked until the methodology document is in `docs/`.**
- **Phase 4 — Composite & Tiering.** Weighted CAS, tiers, explainable components.
- **Phase 5 — Review Dashboard.** React queue + `case_files` workflow.
- **Phase 6 — Backtest Harness.** Score known prosecuted cases; tuning report.

## Ingestion contracts (established by migration 0010 — Phase 1 must honor)

The Phase 0 schema review hardened the foundation. Phase 1 ingestion must obey:

- **raw before awards.** `awards.award_unique_id` FKs `raw_awards` — write the raw
  payload first, the normalized award second, in the same transaction per page.
  Raw is the untrusted source-of-record for reconciliation.
- **awards is summary-grain.** One row per `generated_unique_award_id`, holding
  USAspending's cumulative values. Per-action/modification detail, if MODBALLOON
  needs it, goes in a separate transactions table — never re-derive sums from
  repeated upserts. (See [open-decisions](docs/open-decisions.md) #5.)
- **entity stub upsert never downgrades enrichment.** Ingest upserts a stub
  (`enrichment_status='stub'`); the upsert must be
  `ON CONFLICT (uei) DO UPDATE ... WHERE entities.enriched_at IS NULL` so a nightly
  re-run can't reset an enriched row's registration/address/geocode/socioeconomic
  back to stub. Phase 2 sets `enrichment_status='enriched'` + `enriched_at`.
- **subawards upsert on `natural_key`.** `ON CONFLICT (natural_key) DO UPDATE`. The
  key is set by a trigger (deterministic), so re-syncs add zero duplicates.
- **resolved vs unresolved UEI.** `awards.uei` is the resolved FK (nullable,
  `ON DELETE RESTRICT`). Always persist `raw_recipient_uei` from the payload — a
  NULL `uei` with a non-null `raw_recipient_uei` means *unresolved*, not "no UEI".
- **fiscal_year is GENERATED** from `action_date` (federal FY, Oct 1). Never set it
  from ingest; never trust a calendar-derived source value over it.
- **scorers upsert** `ON CONFLICT (award_unique_id, scorer_name) DO UPDATE` (scores)
  / `ON CONFLICT (award_unique_id)` (composite_scores).

Methodology/owner decisions still open (incl. **PRICEOUT has no USAspending data
source**): see [docs/open-decisions.md](docs/open-decisions.md).

## Out of scope for v1

State/local data, automated FOIA generation, story drafting, and **any
auto-publishing**. A human clears every gate, always.

## Current status

Phase 0 complete + hardened (migrations 0001–0010), reviewed by a multi-lens
adversarial pass. GitHub repo live (private). Vercel deferred to Phase 5 (no
frontend yet). Phase 1 (ingestion) is unblocked and is the next session. Phase 3
is blocked pending `docs/methodology-PENDING.md` being replaced with the real
methodology (it defines the scorers + thresholds).
