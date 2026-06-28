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
| 3 | Scorers — 9 SQL views | ✅ (all 9 live; 6 fire on the dev slice) |
| 4 | Composite & Tiering — CAS + tiers | ✅ (CAS reproduces by hand) |
| 5 | Review Dashboard — React queue + case workflow | ✅ |
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

## The scoring core

The nine scorers ([methodology](docs/methodology.md) Part 1) are SQL views in
migration `0014` — each readable, each reading thresholds from `config`, each
emitting a 0–100 subscore + an `inputs` snapshot. `run_all_scoring()` rebuilds
`scores` + `composite_scores`. CAS = `sum(weight × subscore) / 100`, tiered at
40 / 70. On the VA/541512/FY2023 slice it runs clean: 6 scorers fire, the
high-weight shell/cluster/pass-through scorers correctly stay silent, and the
most-anomalous awards surface in Monitor without false accusations. Validate the
investigation tier via the Phase 6 backtest against known cases.

## The review dashboard (Phase 5)

A React + TypeScript app (Vite) — the human triage surface over the scored leads.

- **Queue** — every scored award ranked by CAS, filterable by tier, searchable by
  vendor / agency / NAICS / PSC.
- **Lead detail** — every fired scorer shown with its subscore, weight, exact CAS
  contribution, the `inputs` snapshot that produced it, **and the benign
  explanation it cannot rule out** rendered prominently. Full FPDS award facts,
  the resolved SAM entity, and source links to USAspending + SAM. The
  "prioritization signal, never a finding" disclaimer is on every scored screen.
- **Case file** — the seven verification gates ([methodology](docs/methodology.md)
  Part 2) as a human-cleared checklist; status **Hold / Kill / Publish** with
  Publish locked until all seven gates clear; sourced evidence and reviewer notes.

The human gate is enforced in software, not just the UI: the browser client
carries only the publishable key and runs as `authenticated`. It **cannot** write
`case_files.status` / `gate_progress` directly (column privilege denies it); the
only path is the `advance_case_status` / `clear_case_gate` SECURITY DEFINER RPCs.
Row-Level Security returns nothing to an anonymous client.

```bash
npm install
cp .env.example .env.local   # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (publishable key)
npm run dev                  # http://localhost:5174
npm run build                # strict tsc + production bundle
```

**Reviewer accounts:** this is an internal tool — anon sees nothing. Create the
first reviewer in the Supabase dashboard (Authentication → Users → Add user, email +
password, mark confirmed). They sign in at `/login`.

**Deploy (Vercel).** The repo is deploy-ready: framework preset `vite`, and
[`vercel.json`](vercel.json) adds the SPA catch-all rewrite so client routes resolve
on direct load. The two public client vars live in [`.env.production`](.env.production)
so a GitHub push builds a working app with no dashboard config (publishable key + URL
are public; RLS is the boundary). Vercel project env vars override the file if set.
The service_role key is never bundled — the deployed bundle is verified to contain
only the publishable key.
