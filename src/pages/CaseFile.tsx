import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchCaseByAward,
  fetchLead,
  createCaseFile,
  assignCase,
  saveReviewerNotes,
  addEvidence,
  clearGate,
  advanceStatus,
} from '../lib/api'
import type {
  CaseFile as CaseFileRow,
  CaseStatus,
  EvidenceRef,
  Tier,
  GateClearance,
} from '../lib/types'
import { GATES, GATE_KEYS, STATUS_META } from '../lib/reference'
import { dateTime, num, orDash } from '../lib/format'
import { useAuth } from '../contexts/AuthContext'
import TierBadge from '../components/TierBadge'
import StatusBadge from '../components/StatusBadge'

export default function CaseFile() {
  const params = useParams<{ awardId: string }>()
  const awardId = decodeURIComponent(params.awardId ?? '')
  const qc = useQueryClient()
  const { user } = useAuth()

  const { data: lead } = useQuery({
    queryKey: ['lead', awardId],
    queryFn: () => fetchLead(awardId),
    enabled: !!awardId,
  })
  const {
    data: caseFile,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['case', awardId],
    queryFn: () => fetchCaseByAward(awardId),
    enabled: !!awardId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['case', awardId] })
    qc.invalidateQueries({ queryKey: ['queue'] })
  }

  const create = useMutation({
    mutationFn: () => createCaseFile(awardId),
    onSuccess: invalidate,
  })

  if (isLoading) return <div className="spin">Loading case…</div>
  if (error) return <div className="alert">{(error as Error).message}</div>

  const backToLead = (
    <Link to={`/lead/${encodeURIComponent(awardId)}`} className="back-link">
      ← Back to lead
    </Link>
  )

  // ── No case yet: offer to open one ──
  if (!caseFile) {
    return (
      <div>
        {backToLead}
        <div className="card mt-16" style={{ maxWidth: 620 }}>
          <div className="section-title">No case file yet</div>
          <p className="dim mb-16">
            Opening a case file moves this lead into the verification workflow — seven
            human-only gates, sourced evidence, and reviewer notes. The score got it
            into the queue; from here a person does the work.
          </p>
          <p className="muted small mb-16">
            {lead?.award.recipient_name ? <strong>{lead.award.recipient_name}</strong> : awardId}
            {lead?.composite && (
              <>
                {' '}· CAS {num(lead.composite.cas, 2)} · {lead.composite.tier} tier
              </>
            )}
          </p>
          <button
            className="btn btn-primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Opening…' : 'Open case file'}
          </button>
          {create.error && (
            <div className="alert mt-16">{(create.error as Error).message}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <CaseFileLoaded
      caseFile={caseFile}
      vendorName={lead?.award.recipient_name ?? null}
      cas={lead?.composite ? num(lead.composite.cas, 2) : null}
      tier={lead?.composite?.tier ?? null}
      currentUserId={user?.id ?? null}
      currentUserEmail={user?.email ?? null}
      backToLead={backToLead}
      onChange={invalidate}
    />
  )
}

interface LoadedProps {
  caseFile: CaseFileRow
  vendorName: string | null
  cas: string | null
  tier: Tier | null
  currentUserId: string | null
  currentUserEmail: string | null
  backToLead: ReactNode
  onChange: () => void
}

function CaseFileLoaded({
  caseFile,
  vendorName,
  cas,
  tier,
  currentUserId,
  currentUserEmail,
  backToLead,
  onChange,
}: LoadedProps) {
  const qc = useQueryClient()
  const awardId = caseFile.award_unique_id

  const refresh = (updated: CaseFileRow) => {
    qc.setQueryData(['case', awardId], updated)
    onChange()
  }

  const assignedToMe = caseFile.assigned_to && caseFile.assigned_to === currentUserId
  const assignedToOther = caseFile.assigned_to && caseFile.assigned_to !== currentUserId
  // Direct column writes (notes/evidence) are RLS-limited to the assignee or an
  // unassigned case. Gate/status changes go through SECURITY DEFINER RPCs.
  const canEditDirect = !caseFile.assigned_to || assignedToMe

  const clearedCount = GATE_KEYS.filter(
    (k) => caseFile.gate_progress?.[k]?.cleared_at,
  ).length
  const allGatesCleared = clearedCount === GATE_KEYS.length

  // ── mutations ──
  const assign = useMutation({
    mutationFn: (uid: string | null) => assignCase(caseFile.id, uid),
    onSuccess: refresh,
  })
  const status = useMutation({
    mutationFn: (vars: { s: CaseStatus; note: string | null }) =>
      advanceStatus(caseFile.id, vars.s, vars.note),
    onSuccess: refresh,
  })
  const gate = useMutation({
    mutationFn: (vars: { key: string; note: string | null }) =>
      clearGate(caseFile.id, vars.key, currentUserEmail, vars.note),
    onSuccess: refresh,
  })
  const notes = useMutation({
    mutationFn: (text: string) => saveReviewerNotes(caseFile.id, text),
    onSuccess: refresh,
  })
  const evidence = useMutation({
    mutationFn: (ref: EvidenceRef) => addEvidence(caseFile.id, caseFile.evidence ?? [], ref),
    onSuccess: refresh,
  })

  return (
    <div>
      {backToLead}

      <div className="lead-hero">
        <div className="lead-hero-main">
          <div className="muted small" style={{ letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Case file
          </div>
          <h1>{orDash(vendorName)}</h1>
          <div className="sub">
            {cas && <span className="mono">CAS {cas}</span>}
            {tier && <TierBadge tier={tier} />}
            <StatusBadge status={caseFile.status} />
            <span className="mono dim">{awardId}</span>
          </div>
        </div>
      </div>

      {/* Status + decision rule + assignment */}
      <div className="gate-banner">
        <div className="stack gap-6" style={{ flex: 1, minWidth: 240 }}>
          <div className="row gap-8">
            <strong>Status:</strong> <StatusBadge status={caseFile.status} />
            <span className="muted small">{STATUS_META[caseFile.status]?.blurb}</span>
          </div>
          <div className="decision-legend">
            <span className="li">
              <b>Publish</b> — all gates cleared
            </span>
            <span className="li">
              <b>Hold</b> — a gate unmet (not a failure)
            </span>
            <span className="li">
              <b>Kill</b> — benign explanation held / artifact (a win)
            </span>
          </div>
        </div>
        <div className="stack gap-6" style={{ alignItems: 'flex-end' }}>
          {assignedToMe && <span className="muted small">Assigned to you</span>}
          {assignedToOther && <span className="note-banner">Assigned to another reviewer</span>}
          {!caseFile.assigned_to && <span className="muted small">Unassigned</span>}
          {assignedToMe ? (
            <button className="btn btn-sm" onClick={() => assign.mutate(null)} disabled={assign.isPending}>
              Release
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => currentUserId && assign.mutate(currentUserId)}
              disabled={assign.isPending || !!assignedToOther}
            >
              Assign to me
            </button>
          )}
        </div>
      </div>

      <div className="cols">
        {/* ── Gates ── */}
        <div>
          <div className="section-title">
            Verification gates · {clearedCount}/{GATE_KEYS.length} cleared
          </div>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>
            Each gate is a human judgment. These transitions are human-only —
            enforced by column privilege, the gate-guard trigger, and the
            <span className="mono"> clear_case_gate</span> /{' '}
            <span className="mono">advance_case_status</span> RPCs. No agent can clear a gate.
          </p>
          <div className="gate-list">
            {GATES.map((g) => (
              <GateRow
                key={g.key}
                ordinal={g.ordinal}
                title={g.title}
                description={g.description}
                clearance={caseFile.gate_progress?.[g.key] ?? null}
                onClear={(note) => gate.mutate({ key: g.key, note })}
                pending={gate.isPending}
              />
            ))}
          </div>
          {gate.error && <div className="alert mt-16">{(gate.error as Error).message}</div>}

          {/* Status actions */}
          <div className="section-title mt-24">Decision</div>
          <div className="row gap-8 wrap">
            <button
              className="btn"
              disabled={status.isPending || caseFile.status === 'queue'}
              onClick={() => status.mutate({ s: 'queue', note: null })}
            >
              Return to queue
            </button>
            <button
              className="btn"
              disabled={status.isPending || caseFile.status === 'hold'}
              onClick={() => status.mutate({ s: 'hold', note: null })}
            >
              Hold
            </button>
            <button
              className="btn btn-danger"
              disabled={status.isPending || caseFile.status === 'kill'}
              onClick={() => status.mutate({ s: 'kill', note: null })}
            >
              Kill
            </button>
            <button
              className="btn btn-good"
              disabled={status.isPending || !allGatesCleared || caseFile.status === 'publish'}
              title={
                allGatesCleared
                  ? 'All gates cleared — cleared for a human to publish'
                  : 'Publish is locked until all seven gates are cleared'
              }
              onClick={() => status.mutate({ s: 'publish', note: null })}
            >
              Publish
            </button>
          </div>
          {!allGatesCleared && (
            <p className="muted small mt-8">
              Publish unlocks only when all seven gates are cleared. {clearedCount}/
              {GATE_KEYS.length} so far.
            </p>
          )}
          {status.error && <div className="alert mt-16">{(status.error as Error).message}</div>}
        </div>

        {/* ── Evidence + notes ── */}
        <div>
          <div className="section-title">Evidence</div>
          {(caseFile.evidence ?? []).length === 0 && (
            <p className="muted small mb-16">
              No evidence attached yet. Every item must carry its source —
              unsourced inference does not belong here.
            </p>
          )}
          {(caseFile.evidence ?? []).map((e, i) => (
            <div key={i} className="evidence-item">
              <div className="src">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noreferrer">
                    {e.source} ↗
                  </a>
                ) : (
                  e.source
                )}
              </div>
              {e.detail && <div className="det">{e.detail}</div>}
              {(e.added_by || e.added_at) && (
                <div className="meta">
                  {e.added_by ? `by ${e.added_by}` : ''}{' '}
                  {e.added_at ? `· ${dateTime(e.added_at)}` : ''}
                </div>
              )}
            </div>
          ))}

          {canEditDirect ? (
            <EvidenceForm
              pending={evidence.isPending}
              onAdd={(ref) =>
                evidence.mutate({
                  ...ref,
                  added_by: currentUserEmail ?? undefined,
                  added_at: new Date().toISOString(),
                })
              }
            />
          ) : (
            <p className="muted small">Read-only — assigned to another reviewer.</p>
          )}
          {evidence.error && <div className="alert mt-16">{(evidence.error as Error).message}</div>}

          <div className="section-title mt-24">Reviewer notes</div>
          {canEditDirect ? (
            <NotesEditor
              initial={caseFile.reviewer_notes ?? ''}
              pending={notes.isPending}
              onSave={(text) => notes.mutate(text)}
            />
          ) : (
            <div className="card dim">{caseFile.reviewer_notes || 'No notes.'}</div>
          )}
          {notes.error && <div className="alert mt-16">{(notes.error as Error).message}</div>}
        </div>
      </div>
    </div>
  )
}

// ── Gate row with inline clear form ──
function GateRow({
  ordinal,
  title,
  description,
  clearance,
  onClear,
  pending,
}: {
  ordinal: string
  title: string
  description: string
  clearance: GateClearance | null
  onClear: (note: string | null) => void
  pending: boolean
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const cleared = !!clearance?.cleared_at

  function submit(e: FormEvent) {
    e.preventDefault()
    onClear(note.trim() || null)
    setOpen(false)
    setNote('')
  }

  return (
    <div className={`gate ${cleared ? 'cleared' : ''}`}>
      <div className="gate-check">{cleared ? '✓' : ''}</div>
      <div className="gate-body">
        <div className="gate-title">
          <span className="gate-ordinal">{ordinal}</span>
          <h3>{title}</h3>
        </div>
        <p className="gate-desc">{description}</p>
        {cleared && (
          <div className="gate-cleared-meta">
            Cleared {clearance?.cleared_by ? `by ${clearance.cleared_by}` : ''}{' '}
            {clearance?.cleared_at ? `· ${dateTime(clearance.cleared_at)}` : ''}
            {clearance?.note && <span className="note"> — “{clearance.note}”</span>}
          </div>
        )}
        {open && (
          <form className="stack gap-8 mt-8" onSubmit={submit}>
            <textarea
              placeholder="Note (what document or check cleared this gate?)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row gap-8">
              <button className="btn btn-primary btn-sm" type="submit" disabled={pending}>
                {pending ? 'Saving…' : cleared ? 'Update clearance' : 'Confirm cleared'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
      {!open && (
        <div className="gate-action">
          <button className="btn btn-sm" onClick={() => setOpen(true)} disabled={pending}>
            {cleared ? 'Update' : 'Clear gate'}
          </button>
        </div>
      )}
    </div>
  )
}

function EvidenceForm({
  onAdd,
  pending,
}: {
  onAdd: (ref: EvidenceRef) => void
  pending: boolean
}) {
  const [source, setSource] = useState('')
  const [detail, setDetail] = useState('')
  const [url, setUrl] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!source.trim()) return
    onAdd({ source: source.trim(), detail: detail.trim() || undefined, url: url.trim() || undefined })
    setSource('')
    setDetail('')
    setUrl('')
  }

  return (
    <form className="stack gap-8 mt-8" onSubmit={submit}>
      <label className="field">
        <span>Source *</span>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. SAM.gov entity record, FPDS J&A, GAO-23-xxxxx" />
      </label>
      <label className="field">
        <span>Detail</span>
        <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What it shows" />
      </label>
      <label className="field">
        <span>URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      <div>
        <button className="btn btn-sm" type="submit" disabled={pending || !source.trim()}>
          {pending ? 'Adding…' : 'Add evidence'}
        </button>
      </div>
    </form>
  )
}

function NotesEditor({
  initial,
  onSave,
  pending,
}: {
  initial: string
  onSave: (text: string) => void
  pending: boolean
}) {
  const [text, setText] = useState(initial)
  const dirty = text !== initial

  return (
    <div className="stack gap-8">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Working notes, open questions, what to pull next…"
        style={{ minHeight: 120 }}
      />
      <div>
        <button className="btn btn-sm" disabled={!dirty || pending} onClick={() => onSave(text)}>
          {pending ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </div>
  )
}
