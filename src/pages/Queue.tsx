import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchQueue } from '../lib/api'
import type { QueueLead, Tier } from '../lib/types'
import { TIER_META } from '../lib/reference'
import { moneyCompact, orDash } from '../lib/format'
import Disclaimer from '../components/Disclaimer'
import TierBadge from '../components/TierBadge'

type TierFilter = Tier | 'all'

/** Fired scorers ranked by contribution to CAS (weight × subscore / 100). */
function topScorers(lead: QueueLead, limit = 4): string[] {
  return Object.entries(lead.components)
    .map(([name, c]) => ({ name, contrib: (c.weight * c.subscore) / 100 }))
    .filter((s) => s.contrib > 0)
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, limit)
    .map((s) => s.name)
}

export default function Queue() {
  const { data, isLoading, error } = useQuery({ queryKey: ['queue'], queryFn: fetchQueue })
  const [tier, setTier] = useState<TierFilter>('all')
  const [q, setQ] = useState('')

  const counts = useMemo(() => {
    const c = { all: 0, monitor: 0, review: 0, investigation: 0 } as Record<TierFilter, number>
    for (const lead of data ?? []) {
      c.all++
      c[lead.tier]++
    }
    return c
  }, [data])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data ?? []).filter((lead) => {
      if (tier !== 'all' && lead.tier !== tier) return false
      if (!needle) return true
      return [
        lead.recipient_name,
        lead.awarding_sub_agency,
        lead.awarding_agency,
        lead.naics,
        lead.psc,
        lead.award_unique_id,
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle))
    })
  }, [data, tier, q])

  return (
    <div>
      <div className="page-head">
        <h1>Review Queue</h1>
        <div className="sub">
          Federal contract awards ranked by Composite Anomaly Score. Highest first.
        </div>
      </div>

      <div className="mb-16">
        <Disclaimer />
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Tier filter">
          {(['all', 'investigation', 'review', 'monitor'] as TierFilter[]).map((t) => (
            <button
              key={t}
              className={tier === t ? 'on' : ''}
              onClick={() => setTier(t)}
              role="tab"
              aria-selected={tier === t}
            >
              {t === 'all' ? 'All' : TIER_META[t].label}
              <span className="count">{counts[t]}</span>
            </button>
          ))}
        </div>
        <input
          className="search-input"
          placeholder="Search vendor, agency, NAICS, PSC…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {isLoading && <div className="spin">Loading queue…</div>}
      {error && <div className="alert">{(error as Error).message}</div>}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="empty">No leads match this filter.</div>
      )}

      <div className="queue">
        {filtered.map((lead) => {
          const scorers = topScorers(lead)
          return (
            <Link
              key={lead.award_unique_id}
              to={`/lead/${encodeURIComponent(lead.award_unique_id)}`}
              className="lead-row"
            >
              <div className={`cas-badge tier-text-${lead.tier}`}>
                {Number(lead.cas).toFixed(0)}
                <span className="cas-label">CAS</span>
              </div>

              <div className="lead-main">
                <div className="lead-name">{orDash(lead.recipient_name)}</div>
                <div className="lead-meta">
                  <span>{orDash(lead.awarding_sub_agency)}</span>
                  <span className="mono">{moneyCompact(lead.obligation)}</span>
                  {lead.naics && <span className="mono">NAICS {lead.naics}</span>}
                  {lead.psc && <span className="mono">PSC {lead.psc}</span>}
                  {lead.fiscal_year && <span className="mono">FY{lead.fiscal_year}</span>}
                </div>
              </div>

              <div className="lead-right">
                <div className="row gap-8">
                  {lead.has_case && <span className="chip chip-case">CASE</span>}
                  <TierBadge tier={lead.tier} title />
                </div>
                <div className="scorer-chips">
                  {scorers.map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
