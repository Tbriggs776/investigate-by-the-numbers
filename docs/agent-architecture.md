# Investigate by the Numbers — Agent Architecture

> Source spec, as provided. Companion to the methodology and the build brief.
> Agents carry ~80% of the labor; the human 20% (the gate, the judgment, the
> publish button) is the brand.

## The governing design

Agents do everything up to the gate and everything after publication. A human
owns the gate and the publish decision. **Enforced in software, not just policy.**
The `case_files` table is the shared spine. Agents may read any case and advance
evidence, but the status transitions that matter (clearing a verification gate,
marking a story published) are human-only writes. An agent literally cannot act
past its permitted status.

**The 80/20 split.**
- Agents remove: data ingestion, monitoring, research/dossier assembly, document processing, FOIA drafting, story drafting, all distribution. (80%)
- Humans keep: clearing each verification gate, the steelman judgment, the right-of-reply contact, editing/approving drafts, pressing publish. (20%)

## Tier map

| Tier | Agents | Autonomy | May touch |
|---|---|---|---|
| Green | Ingest, Sentinel, Dossier, Document, FOIA | Autonomous | Gather + surface only. Never assert wrongdoing. |
| Yellow | Story-Draft, Social-Draft, Distribution | Draft + queue | Drafts a human approves before anything goes public. |
| Red | (none) | Never built | Auto-publishing, auto-posting claims, deciding fraud, clearing gates, contacting subjects. |

## Green agents (autonomous, no claims)

1. **Ingest** — nightly USAspending pull + SAM enrichment (build brief Phases 1–2). Edge Function, scheduled.
2. **Sentinel** — monitoring. Runs after each nightly scoring pass. Watches new awards crossing into the investigation tier, watchlist entities, FOIA deadlines, sudden modification balloons. Writes to `alerts`, sends a digest, opens a `case_file` stub per new investigation-tier flag. Full autonomy; surfaces, never characterizes.
3. **Dossier** — Gate-1 / most of Gate-2 evidence gathering. On a case entering review/investigation tier. Pulls corporate registry + officers, property records, related entities by shared address/agent, prior IG/GAO findings, news mentions. Assembles a sourced dossier; every item carries provenance; if it can't source a fact, it omits it.
4. **Document** — contract PDFs → structured evidence. OCR, extract fields, summarize the J&A, build the modification timeline. Low-confidence extractions flagged for human review, never guessed.
5. **FOIA** — drafts a targeted records request to the correct agency. Drafts only; a human reviews and sends.

## Yellow agents (draft, human approves)

6. **Story-Draft** — turns a fully verified case into a first draft. **Hard guardrail: refuses to draft if the gates are not cleared.** Enforces "the records show," never "this is fraud." Tags every claim confirmed/disputed/unverified, links each to its source. Cannot publish; cannot invent facts beyond the case_file evidence.
7. **Social-Draft** — runs only on stories a human marked published. Drafts the X thread + variants. Queues posts; posts only after explicit human approval. Never originates a claim.
8. **Distribution** — newsletter + short-form repackaging from published work. Drafts; a human approves the send.

## Red line (never build)

- No auto-publishing of anything.
- No auto-posting of any claim that has not cleared every gate.
- No agent that decides something is fraud. Agents gather and draft; humans conclude.
- No agent clears a verification gate. Each gate is a human judgment.
- No agent contacts a subject. An agent may draft questions; a person sends them and weighs the answers.

## Build order (waves)

- **Wave 1: Foundation + monitoring.** Ingest, Sentinel.
- **Wave 2: Labor savers.** Dossier, Document.
- **Wave 3: Records.** FOIA.
- **Wave 4: Drafting + distribution.** Story-Draft → Social-Draft → Distribution.

One agent per session. Each ships only when it passes its acceptance criteria and
respects the status gate.
