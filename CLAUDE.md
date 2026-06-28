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
  `config`, test slice defined.
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

Phases 0 and 1 complete. **Phase 1 ingest** (`ingest-awards` edge function) is
proven against the VA/541512/FY2023 slice: 150 awards / 61 entity stubs, full
FPDS field coverage, idempotent (a second run added zero duplicates), 3-page
pagination, and a nightly `pg_cron` + `pg_net` schedule (`ingest-awards-nightly`,
08:00 UTC) whose dispatch path was verified end-to-end (200, ok). The slice comes
from `config.test_slice`; the invoke key lives in Vault as `ingest_invoke_key`.

**Phase 2 entity resolution** (`enrich-entities` edge function) is proven: SAM.gov
registration/CAGE/address/socioeconomic + Census geocoding, upserting stub→enriched.
Hand-checked (Leidos UEI NPUZV84KPU17 matches SAM exactly). 35 of 64 entities
enriched on the first pass before the **SAM daily API quota** capped us (HTTP 429,
resets 00:00 UTC). Re-run `enrich-entities` with `onlyStubs=true` after reset — or
use a higher-quota SAM key — to finish the remaining 29. The SAM key lives in Vault
(`sam_api_key`), read via the service-role-only `get_vault_secret` RPC.

Accepted lints (documented, not fixed): the two gate RPCs are SECURITY DEFINER by
design; `pg_net` sits in the `public` schema (moving it risks the proven cron — low
real risk on an anon-locked DB).

**Subaward ingestion** (`ingest-subawards`) is built and proven idempotent (two
runs → 10 rows, not 20 — the live confirmation of the 0010 natural_key fix). It
links subawards to held primes and skips orphans. Coverage is currently thin (the
slice-feed approach); a per-prime fetch is the fuller approach for PASSTHRU — see
[open-decisions](docs/open-decisions.md) #4. Transaction-grain modification detail
remains deferred.

**Phases 3 + 4 are done.** The nine scorers ([docs/methodology.md](docs/methodology.md)
Part 1) are SQL views in migration 0014 — one readable view per flag, each reading
thresholds from `config`, each emitting a 0–100 subscore + `inputs` snapshot.
`run_all_scoring()` (service_role only) rebuilds `scores` + `composite_scores`; CAS =
`sum(weight×subscore)/100`, tiered 40/70. Proven on the slice: CAS reproduces by hand
from components; top lead is a price-outlier-plus-competition-collapse award (MUMPS
AUDIOFAX, CAS 19); all 157 in Monitor (no fraud in this slice — validate the
investigation tier via the Phase 6 backtest). An adversarial per-scorer review
(migration 0016) corrected real bugs: **MODBALLOON disabled** (its summary-grain ratio
measured unexercised options = the benign case), PASSTHRU restricted to qualifying
set-aside codes, COMPCOLLAPSE null-join guard, PRICEOUT mean-centered z + median branch,
SOLECONC min-award guard, FYE min-denominator guard, plus benign-explanation notes.
Five scorers currently fire (NELA/CLUSTER/PASSTHRU/MODBALLOON silent on this slice).

Data-reach proxies (methodology permits "where available"): PRICEOUT = obligation-per-PSC
(no unit price in USAspending); MODBALLOON = current/base ratio (mod-vs-option deferred);
CLUSTER = address-only (officer/agent → Dossier agent); GEOMISMATCH = state-level
(site-type → property records). All documented in [open-decisions](docs/open-decisions.md).

**Phase 5 is done.** The review dashboard is a React + TypeScript (Vite) app under `src/`
— the human triage surface. **Queue** ranks every scored award by CAS (tier filter +
search); **Lead detail** renders each fired scorer with subscore/weight/exact CAS
contribution + its `inputs` snapshot + its benign-explanation note, plus full FPDS facts,
the SAM entity, and source links — the "prioritization signal, never a finding" disclaimer
on every scored screen; **Case file** drives the seven verification gates as a human-cleared
checklist (`clear_case_gate`), status Hold/Kill/Publish (`advance_case_status`, Publish
locked until all 7 clear), sourced evidence + reviewer notes. The browser carries only the
publishable key and runs as `authenticated`; it CANNOT write status/gate_progress directly
(column grant denies it — only the RPCs can), and anon reads nothing (RLS). Proven: strict
`tsc` + vite build clean; live end-to-end as `authenticated` (create case, clear gate +
advance status via RPC, save notes — all succeed; a direct `status` write returns
`permission denied`; queue reads 157 rows sorted by CAS; anon read denied). Reviewer
accounts are provisioned in the Supabase dashboard (Auth → Users); they sign in at `/login`.
Frontend env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are public — RLS is the
boundary; see `.env.example`.

**Next:** Phase 6 (backtest harness — score known prosecuted cases, validate the
investigation tier, produce a tuning report). The Wave-1 **Sentinel** agent is also
unblocked (scores exist to monitor). Light follow-ups: finish the 12 remaining SAM entity
stubs after the daily quota resets; a per-prime subaward fetch for full PASSTHRU coverage.
