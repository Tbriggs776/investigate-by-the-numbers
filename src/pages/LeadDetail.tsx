import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchLead, fetchCaseByAward } from '../lib/api'
import type { ScoreRow } from '../lib/types'
import { SCORERS, TIER_META } from '../lib/reference'
import {
  money,
  date,
  orDash,
  usaspendingUrl,
  samUrl,
  num,
} from '../lib/format'
import Disclaimer from '../components/Disclaimer'
import TierBadge from '../components/TierBadge'
import ScorerCard from '../components/ScorerCard'

export default function LeadDetail() {
  const params = useParams<{ awardId: string }>()
  const awardId = decodeURIComponent(params.awardId ?? '')

  const { data, isLoading, error } = useQuery({
    queryKey: ['lead', awardId],
    queryFn: () => fetchLead(awardId),
    enabled: !!awardId,
  })
  const { data: caseFile } = useQuery({
    queryKey: ['case', awardId],
    queryFn: () => fetchCaseByAward(awardId),
    enabled: !!awardId,
  })

  if (isLoading) return <div className="spin">Loading lead…</div>
  if (error) return <div className="alert">{(error as Error).message}</div>
  if (!data) return <div className="empty">Lead not found.</div>

  const { award, entity, composite, scores } = data

  // Weight per scorer: prefer the exact weight recorded in the composite
  // components (the value actually used), fall back to the reference table.
  const weightFor = (name: string): number =>
    composite?.components?.[name]?.weight ?? SCORERS[name]?.weight ?? 0

  const fired = [...scores].sort(
    (a, b) =>
      weightFor(b.scorer_name) * Number(b.subscore) -
      weightFor(a.scorer_name) * Number(a.subscore),
  )
  const firedNames = new Set(fired.map((s) => s.scorer_name))
  const silent = Object.keys(SCORERS).filter((n) => !firedNames.has(n))

  return (
    <div>
      <Link to="/" className="back-link">
        ← Back to queue
      </Link>

      <div className="lead-hero">
        <div className="lead-hero-main">
          <h1>{orDash(award.recipient_name)}</h1>
          <div className="sub">
            {award.uei ? (
              <span className="mono">UEI {award.uei}</span>
            ) : (
              <span className="mono dim">UEI unresolved</span>
            )}
            <span>{orDash(award.awarding_sub_agency)}</span>
            {award.fiscal_year && <span>FY{award.fiscal_year}</span>}
            <span className="mono">{money(award.obligation)}</span>
          </div>
        </div>
        {composite && (
          <div className="cas-hero">
            <div className={`n tier-text-${composite.tier}`}>
              {num(composite.cas, 2)}
            </div>
            <div className="l">Composite Anomaly Score</div>
            <div className="mt-8">
              <TierBadge tier={composite.tier} />
            </div>
          </div>
        )}
      </div>

      <div className="mb-16">
        <Disclaimer inline />
      </div>

      <div className="row gap-12 mb-24 wrap">
        <Link
          to={`/case/${encodeURIComponent(award.award_unique_id)}`}
          className="btn btn-primary"
        >
          {caseFile ? 'Open case file →' : 'Start case file →'}
        </Link>
        <div className="source-links">
          <a href={usaspendingUrl(award.award_unique_id)} target="_blank" rel="noreferrer">
            USAspending ↗
          </a>
          {award.uei && (
            <a href={samUrl(award.uei)} target="_blank" rel="noreferrer">
              SAM.gov entity ↗
            </a>
          )}
        </div>
      </div>

      {/* Why this surfaced */}
      <div className="section-title">Why this surfaced</div>
      {composite && (
        <p className="muted small mb-16" style={{ marginTop: -6 }}>
          CAS {num(composite.cas, 2)} ={' '}
          {fired
            .map(
              (s) =>
                `${s.scorer_name} ${num((weightFor(s.scorer_name) * Number(s.subscore)) / 100, 2)}`,
            )
            .join(' + ')}{' '}
          · {TIER_META[composite.tier].label} tier ({TIER_META[composite.tier].range})
        </p>
      )}

      <div className="scorers mb-24">
        {fired.length === 0 && (
          <div className="card muted">No scorer flagged this award. It is in the queue at a baseline score.</div>
        )}
        {fired.map((s: ScoreRow) => (
          <ScorerCard
            key={s.scorer_name}
            name={s.scorer_name}
            subscore={Number(s.subscore)}
            weight={weightFor(s.scorer_name)}
            inputs={s.inputs ?? {}}
          />
        ))}

        {silent.length > 0 && (
          <div className="scorer-card scorer-silent">
            <div className="section-title" style={{ marginBottom: 8 }}>
              Scorers that did not fire
            </div>
            {silent.map((n) => (
              <div key={n} className="silent-row">
                <span className="scorer-code">{n}</span>
                <span className="dim small">{SCORERS[n]?.label}</span>
                <span className="silent-tag">
                  {SCORERS[n]?.disabled ? 'disabled' : 'silent'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cols">
        {/* The award */}
        <div className="card">
          <div className="section-title">The award (FPDS / USAspending)</div>
          <dl className="kv">
            <dt>Award ID</dt>
            <dd className="mono">{award.award_unique_id}</dd>
            <dt>PIID</dt>
            <dd className="mono">{orDash(award.piid)}</dd>
            <dt>Parent award</dt>
            <dd className="mono">{orDash(award.parent_award_id)}</dd>
            <dt>Obligation</dt>
            <dd className="mono">{money(award.obligation)}</dd>
            <dt>Base value</dt>
            <dd className="mono">{money(award.base_value)}</dd>
            <dt>Current total value</dt>
            <dd className="mono">{money(award.current_total_value)}</dd>
            <dt>Action date</dt>
            <dd>{date(award.action_date)}</dd>
            <dt>Period of performance</dt>
            <dd>
              {date(award.period_of_performance_start)} → {date(award.period_of_performance_end)}
            </dd>
            <dt>NAICS</dt>
            <dd>
              <span className="mono">{orDash(award.naics)}</span>{' '}
              {award.naics_description && <span className="dim">{award.naics_description}</span>}
            </dd>
            <dt>PSC</dt>
            <dd>
              <span className="mono">{orDash(award.psc)}</span>{' '}
              {award.psc_description && <span className="dim">{award.psc_description}</span>}
            </dd>
            <dt>Extent competed</dt>
            <dd className="mono">{orDash(award.extent_competed)}</dd>
            <dt>Offers received</dt>
            <dd className="mono">{orDash(award.offers_received)}</dd>
            <dt>Set-aside</dt>
            <dd className="mono">{orDash(award.set_aside_type)}</dd>
            <dt>Solicitation procedures</dt>
            <dd className="mono">{orDash(award.solicitation_procedures)}</dd>
            <dt>Other than full & open</dt>
            <dd className="mono">{orDash(award.other_than_full_and_open_competition)}</dd>
            <dt>Pricing type</dt>
            <dd className="mono">{orDash(award.type_of_contract_pricing)}</dd>
            <dt>Awarding agency</dt>
            <dd>{orDash(award.awarding_agency)}</dd>
            <dt>Awarding office</dt>
            <dd>
              {orDash(award.awarding_office_name)}{' '}
              {award.awarding_office_code && (
                <span className="mono dim">({award.awarding_office_code})</span>
              )}
            </dd>
            <dt>Place of performance</dt>
            <dd>
              {[award.place_of_performance_city, award.place_of_performance_state]
                .filter(Boolean)
                .join(', ') || '—'}{' '}
              {award.place_of_performance_zip && (
                <span className="mono dim">{award.place_of_performance_zip}</span>
              )}
            </dd>
          </dl>
        </div>

        {/* The vendor */}
        <div className="card">
          <div className="section-title">The vendor (SAM.gov)</div>
          {entity ? (
            <dl className="kv">
              <dt>Legal name</dt>
              <dd>{orDash(entity.legal_name)}</dd>
              <dt>UEI</dt>
              <dd className="mono">{entity.uei}</dd>
              <dt>CAGE</dt>
              <dd className="mono">{orDash(entity.cage_code)}</dd>
              <dt>Registration status</dt>
              <dd className="mono">{orDash(entity.registration_status)}</dd>
              <dt>Initial registration</dt>
              <dd>{date(entity.initial_registration_date)}</dd>
              <dt>Registration expires</dt>
              <dd>{date(entity.registration_expiration_date)}</dd>
              <dt>Address</dt>
              <dd>
                {[entity.address_line1, entity.city, entity.state, entity.zip]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </dd>
              <dt>Geocode</dt>
              <dd className="mono">
                {entity.latitude && entity.longitude
                  ? `${num(entity.latitude, 4)}, ${num(entity.longitude, 4)} (${orDash(entity.geocode_precision)})`
                  : '—'}
              </dd>
              <dt>Primary NAICS</dt>
              <dd className="mono">{orDash(entity.naics_primary)}</dd>
              <dt>Prior UEI / DUNS</dt>
              <dd className="mono">
                {[entity.prior_uei, entity.prior_duns].filter(Boolean).join(' / ') || '—'}
              </dd>
              <dt>Exclusion flag</dt>
              <dd className="mono">{entity.exclusion_flag ? 'TRUE' : 'false'}</dd>
              <dt>Enrichment</dt>
              <dd className="mono">{orDash(entity.enrichment_status)}</dd>
            </dl>
          ) : (
            <div className="note-banner">
              Vendor not yet resolved in SAM. UEI on the award:{' '}
              <span className="mono">{orDash(award.raw_recipient_uei ?? award.uei)}</span>. A null
              resolution means <em>unresolved</em>, not "no vendor" — Gate 1 (Entity Resolution)
              must close this before any conclusion.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
