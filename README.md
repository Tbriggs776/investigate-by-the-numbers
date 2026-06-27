# Investigate by the Numbers

Government contracting anomaly engine — investigative infrastructure for a news
organization. Ingests public federal contracting data, resolves vendors to real
entities, scores awards for anomalies, and surfaces ranked leads to human
reviewers.

**The anomaly score is a prioritization signal, never a finding.** This is a
ranked queue for humans, not an accusation generator. See [CLAUDE.md](./CLAUDE.md)
for the governing rules and the human-gate design.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Scaffold — repo, Supabase, schema, config seed, test slice | ✅ |
| 1 | Ingestion — USAspending pull, idempotent, nightly | ✅ |
| 2 | Entity Resolution — SAM.gov enrichment + geocoding | ✅ * |
| 3 | Scorers — 9 SQL views w/ fixtures | ☐ (blocked: needs methodology doc) |
| 4 | Composite & Tiering — CAS + tiers | ☐ |
| 5 | Review Dashboard — React queue + case workflow | ☐ |
| 6 | Backtest Harness — score known cases | ☐ |

\* Phase 2 pipeline is proven (SAM enrichment + Census geocoding; sampled records
match SAM by hand). 35 of 64 entities enriched on the first run before the SAM
**daily API quota** was hit; re-run `enrich-entities` (`onlyStubs=true`) after the
quota resets, or use a higher-quota SAM key, to finish the rest.

## Layout

```
supabase/migrations/   schema as numbered SQL migrations (applied over MCP)
supabase/functions/    edge functions (ingestion etc. — Phase 1+)
src/                   React + TypeScript review dashboard (Phase 5)
docs/                  methodology, build brief, agent architecture
```

## Stack

Supabase (Postgres + Edge Functions), Vercel, React + TypeScript.

## Required before Phase 3

`docs/methodology-PENDING.md` must be replaced with the real methodology
document — it defines the nine scorers and their thresholds. No scorer is built
without it.
