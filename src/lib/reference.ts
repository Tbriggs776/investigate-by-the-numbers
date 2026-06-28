// Static reference metadata for the UI: human-readable labels for the nine
// scorers and the seven verification gates. Sourced verbatim-in-spirit from
// docs/methodology.md (Part 1 scorers + Part 2 verification standard). The
// canonical thresholds/weights live in the `config` table; this file only
// supplies display copy so a reviewer can read *what* a flag means.

import type { Tier } from './types'

export interface ScorerMeta {
  /** What it detects, one line. */
  what: string
  /** Full display name. */
  label: string
  /** Methodology weight (for reference; authoritative copy is in config). */
  weight: number
  /** True if the scorer is currently disabled (cannot fire). */
  disabled?: boolean
}

// Keyed by the scorer_name stored in `scores` / `composite_scores.components`.
export const SCORERS: Record<string, ScorerMeta> = {
  NELA: {
    label: 'New Entity, Large Award',
    weight: 18,
    what: 'A newly or recently SAM-registered vendor winning an unusually large award — little track record behind a big obligation.',
  },
  CLUSTER: {
    label: 'Address Clustering',
    weight: 16,
    what: 'Multiple distinct vendors resolving to the same physical address — a possible shell or shared-control pattern.',
  },
  PASSTHRU: {
    label: 'Pass-Through Set-Aside',
    weight: 14,
    what: 'A small-business / 8(a) / SDVOSB / WOSB / HUBZone set-aside prime subcontracting most of the dollars back out — the set-aside benefit may not reach the intended firm.',
  },
  MODBALLOON: {
    label: 'Modification Ballooning',
    weight: 12,
    disabled: true,
    what: 'Award value growing far beyond its original base through modifications. DISABLED: needs transaction-grain mod history; at summary grain the only available ratio measures benign unexercised options (see open-decisions #5).',
  },
  SOLECONC: {
    label: 'Sole-Source Concentration',
    weight: 12,
    what: 'A vendor capturing a high share of non-competed dollars from one sub-agency across multiple awards — concentration of sole-source spend.',
  },
  COMPCOLLAPSE: {
    label: 'Competition Collapse',
    weight: 8,
    what: 'Nominally competed solicitations that repeatedly draw exactly one offer from the same vendor at the same sub-agency — competition in name only.',
  },
  PRICEOUT: {
    label: 'Price Outlier',
    weight: 8,
    what: 'Obligation far above the peer cohort for the same product/service code (PSC). Proxy: obligation per PSC, not unit price (USAspending carries no line-item pricing).',
  },
  FYE: {
    label: 'Fiscal Year-End Surge',
    weight: 6,
    what: 'A sub-agency concentrating an outsized share of its base awards in the closing weeks of the fiscal year — "use it or lose it" pressure.',
  },
  GEOMISMATCH: {
    label: 'Geographic Mismatch',
    weight: 6,
    what: 'Vendor state of record differs from the place of performance. State-level proxy only; for a services NAICS a mismatch is often expected-benign (remote/distributed work).',
  },
}

export interface GateMeta {
  key: string
  /** Gate ordinal, e.g. "Gate 0". */
  ordinal: string
  title: string
  description: string
}

// The seven human-only verification gates, in order. An investigation candidate
// clears these in sequence; fail one and it goes to Hold or Kill.
export const GATES: GateMeta[] = [
  {
    key: 'gate_0',
    ordinal: 'Gate 0',
    title: 'Data Integrity',
    description:
      'Re-pull from the SAM/USAspending source; rule out an artifact (duplicate, mis-key, reporting lag, wrong fiscal year); confirm the record is FY2017 or later.',
  },
  {
    key: 'gate_1',
    ordinal: 'Gate 1',
    title: 'Entity Resolution',
    description:
      'Resolve the UEI to a legal entity, its owners and officers; pull SAM history and any prior UEI/DUNS; verify the address by geocode and a site check.',
  },
  {
    key: 'gate_2',
    ordinal: 'Gate 2',
    title: 'The Steelman',
    description:
      'Write the strongest innocent explanation for each flag, then obtain the primary document that confirms or kills it. The gate that keeps you out of court.',
  },
  {
    key: 'gate_3',
    ordinal: 'Gate 3',
    title: 'Independent Corroboration',
    description:
      'Two or more independent sources beyond the score — the score is not a source. Log provenance for each.',
  },
  {
    key: 'gate_4',
    ordinal: 'Gate 4',
    title: 'Right of Reply',
    description:
      'Contact the vendor and the agency with specific, document-anchored questions. Ask, do not accuse. Record the responses verbatim.',
  },
  {
    key: 'gate_5',
    ordinal: 'Gate 5',
    title: 'Legal & Harm Review',
    description:
      'Mandatory libel read. "The records show," never "this is fraud." Tie claims to specific actors and dollars, never to a community.',
  },
  {
    key: 'gate_6',
    ordinal: 'Gate 6',
    title: 'Publication Standard',
    description:
      'Tag each claim confirmed / disputed / unverified; link the primary documents; have corrections ready. Do not publish anything resting on the score alone.',
  },
]

export const GATE_KEYS: string[] = GATES.map((g) => g.key)

export const TIER_META: Record<Tier, { label: string; range: string; blurb: string }> = {
  monitor: {
    label: 'Monitor',
    range: '0–39',
    blurb: 'No action. Logged and watched.',
  },
  review: {
    label: 'Review',
    range: '40–69',
    blurb: 'An analyst eyeballs it.',
  },
  investigation: {
    label: 'Investigation',
    range: '70–100',
    blurb: 'Candidate enters the verification gate.',
  },
}

export const STATUS_META: Record<
  string,
  { label: string; blurb: string }
> = {
  queue: { label: 'Queue', blurb: 'Awaiting review.' },
  hold: { label: 'Hold', blurb: 'A gate is unmet — not a failure, parked for now.' },
  kill: { label: 'Kill', blurb: 'Benign explanation held or the data was an artifact — a win for the brand.' },
  publish: { label: 'Publish', blurb: 'All gates cleared. Cleared for a human to publish.' },
}
