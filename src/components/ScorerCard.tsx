import { SCORERS } from '../lib/reference'
import { humanizeKey, num } from '../lib/format'

// Keys inside a scorer's `inputs` that are caveat prose, not data points. They
// render as the benign-explanation callout rather than in the inputs grid.
const CAVEAT_KEYS = new Set(['note', 'proxy'])

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return num(v, 4)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

interface Props {
  name: string
  subscore: number
  weight: number
  inputs: Record<string, unknown> & { note?: string }
}

/**
 * One fired scorer, fully explained: its subscore, its weight, the exact
 * contribution it made to the CAS, the input snapshot that produced it, and —
 * prominently — the benign explanation the methodology requires it to carry.
 * If a reviewer cannot read *why* this flag fired from this card, the code is wrong.
 */
export default function ScorerCard({ name, subscore, weight, inputs }: Props) {
  const meta = SCORERS[name]
  const contribution = (weight * subscore) / 100

  const caveats: string[] = []
  const data: [string, unknown][] = []
  for (const [k, v] of Object.entries(inputs ?? {})) {
    if (CAVEAT_KEYS.has(k) && typeof v === 'string') caveats.push(v)
    else data.push([k, v])
  }

  return (
    <div className="scorer-card fired">
      <div className="scorer-head">
        <span className="scorer-code">{name}</span>
        <span className="scorer-label">{meta?.label ?? name}</span>
      </div>
      {meta?.what && <p className="scorer-what">{meta.what}</p>}

      <div className="scorer-metrics">
        <div className="metric">
          <span className="v">{num(subscore, 1)}</span>
          <span className="k">Subscore / 100</span>
        </div>
        <div className="metric">
          <span className="v">{weight}</span>
          <span className="k">Weight</span>
        </div>
        <div className="metric">
          <span className="v">+{num(contribution, 2)}</span>
          <span className="k">CAS points</span>
        </div>
        <div className="bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(0, subscore))}%` }} />
        </div>
      </div>

      {data.length > 0 && (
        <div className="inputs-grid">
          {data.map(([k, v]) => (
            <div key={k}>
              <div className="ig-k">{humanizeKey(k)}</div>
              <div className="ig-v">{renderValue(v)}</div>
            </div>
          ))}
        </div>
      )}

      {caveats.length > 0 && (
        <div className="benign">
          <span className="benign-label">Consider the innocent explanation</span>
          {caveats.map((c, i) => (
            <p key={i}>{c}</p>
          ))}
        </div>
      )}
    </div>
  )
}
