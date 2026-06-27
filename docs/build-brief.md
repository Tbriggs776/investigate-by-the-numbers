# Investigate by the Numbers — Build Brief for Claude Code

> Source spec, as provided. Implements the methodology (see `methodology-PENDING.md`).
> Section A is reproduced into the repo-root `CLAUDE.md`.

## Section A: Project Rules (used as CLAUDE.md)

**What this project is.** A pipeline that ingests public federal contracting
data, resolves vendors to real entities, scores awards for anomalies, and
surfaces ranked leads to human reviewers. It is investigative infrastructure for
a news organization.

**The non-negotiable principle.** The anomaly score is a prioritization signal,
never a finding. No score, label, or model output is ever presented as evidence
of wrongdoing. The product is a ranked queue for humans, not an accusation
generator. Keep all scoring logic readable and inspectable. If a reviewer cannot
read why an award scored high, the code is wrong.

**Engineering rules.**
- Work one phase at a time. Do not begin a phase until the previous passes its acceptance criteria.
- Write fixture-based tests before or alongside each scorer. A scorer ships only when it passes known-good and known-bad cases.
- Keep each scorer as its own readable SQL object. Do not consolidate scorers into one opaque query.
- All regulatory thresholds live in a `config` table, never hardcoded.
- All ingestion is idempotent. Re-running a sync must not duplicate records.
- Restrict trend logic to FY2017 and later.
- Treat ingested data as untrusted. Reconcile against source records before anything is called confirmed.

**Stack.** Supabase (Postgres + Edge Functions), Vercel, React with TypeScript.
Connect to Supabase over MCP to run migrations and query directly.

## Section B: Architecture

```
USAspending API ──nightly──> Edge Function (ingest) ──> Postgres raw tables
                                                              │
                              SAM.gov enrichment ────────────>│ (entity resolution)
                                                              ▼
                                                     normalized tables
                                                              │
                                                   SQL scorer views (one per flag)
                                                              ▼
                                                  composite score + tiering view
                                                              ▼
                                          React review dashboard (Vercel) ── human triage
```

The whole scoring core lives in Postgres as views and materialized views. The
Edge Functions move data. The React app is a triage surface, not where logic lives.

## Section C: Data Model (target schema)

- `raw_awards`: untouched JSON plus key columns from USAspending, keyed by award unique id.
- `entities`: one row per UEI. Legal name, registration_date, address (normalized + geocoded), socioeconomic flags, prior UEI/DUNS, source = SAM.gov.
- `awards`: normalized award facts. UEI (FK to entities), agency, sub_agency, obligation, base_value, current_total_value, action_date, period dates, naics, psc, extent_competed, offers_received, set_aside_type, parent_award_id, modification info.
- `subawards`: sub-recipient, amount, sub business size, parent award id.
- `config`: key, value, description. Holds every threshold from the methodology.
- `address_exclusions`: known coworking, registered-agent, incubator addresses to suppress from clustering.
- `scores`: award id, scorer name, subscore, inputs snapshot, scored_at.
- `composite_scores`: award id, CAS, tier, component breakdown, scored_at.
- `case_files`: award id, status (queue, hold, kill, publish), gate progress, reviewer notes, attached evidence references. Where the verification standard lives in software.

## Section D: Build Phases

Each phase is a session with acceptance criteria that must pass before moving on.

- **Phase 0: Scaffold.** Repo, Supabase connection over MCP, schema as migrations, `config` seeded with placeholder thresholds, one narrow test slice (single agency + one NAICS). Acceptance: migrations apply cleanly; config queryable; test slice defined.
- **Phase 1: Ingestion.** Edge Function pulls awards for the test slice, pagination, idempotent upserts into `raw_awards`/`awards`, nightly trigger. Acceptance: a sync populates tables; a second run adds zero duplicates; pagination handles multi-page.
- **Phase 2: Entity Resolution.** Enrich `entities` from SAM.gov (registration dates, ownership, socioeconomic, normalized + geocoded addresses). Link every award to an entity by UEI. Seed `address_exclusions`. Acceptance: awards resolve to entities; registration dates present; addresses geocoded to suite level; sampled records match SAM by hand.
- **Phase 3: Scorers (one at a time).** Each scorer from the methodology as its own SQL view writing to `scores`, easiest to hardest: NELA, CLUSTER, SOLECONC, COMPCOLLAPSE, MODBALLOON, PASSTHRU, FYE, PRICEOUT, GEOMISMATCH. Fixtures per scorer. Acceptance per scorer: passes fixtures; readable; pulls thresholds from `config`; documents benign explanations it can't rule out.
- **Phase 4: Composite and Tiering.** `composite_scores` view weights subscores into CAS and assigns tiers. Store component breakdown. Acceptance: CAS reproduces by hand; tiers assign correctly; weights live in `config`.
- **Phase 5: Review Dashboard.** React app on Vercel showing the queue ranked by CAS, each award expandable to components, entity detail, source links. `case_files` workflow for gate progression + evidence. Acceptance: queue loads/sorts; an award opens to a full sourced breakdown; reviewer can advance gates and record notes.
- **Phase 6: Backtest Harness.** Load already-prosecuted cases; report how they score. Acceptance: known fraud lands in investigation tier at a meaningful rate; tuning report shows weights to adjust.

## Section E: Guardrails to Restate Each Session

- The score ranks leads. It never appears in published work as proof.
- Thresholds come from `config`, confirmed against current FAR/SBA rules, never hardcoded.
- Scorers stay separate and readable.
- No story logic in the front end.
- Reconcile against source records before anything is treated as confirmed.

## Section F: Out of Scope for v1

Automated FOIA generation, natural-language story drafting, state/local data, any
auto-publishing. A human clears every gate. Always.
