import { supabase } from './supabase'
import type {
  Award,
  CaseFile,
  CaseStatus,
  CompositeScore,
  Entity,
  EvidenceRef,
  QueueLead,
  ScoreRow,
  Tier,
} from './types'

// ── Queue ────────────────────────────────────────────────────────────────────

const QUEUE_AWARD_COLS =
  'recipient_name, awarding_sub_agency, awarding_agency, obligation, naics, psc, fiscal_year'

interface QueueRow {
  award_unique_id: string
  cas: string
  tier: Tier
  components: Record<string, { weight: number; subscore: number }>
  awards: {
    recipient_name: string | null
    awarding_sub_agency: string | null
    awarding_agency: string | null
    obligation: string | null
    naics: string | null
    psc: string | null
    fiscal_year: number | null
  } | null
}

/**
 * The ranked queue: every scored award, highest CAS first, joined to its award
 * facts, flagged with whether a case file already exists. Ordering by CAS is the
 * whole point — a high score earns a place in the queue, nothing more.
 */
export async function fetchQueue(): Promise<QueueLead[]> {
  const [{ data: rows, error }, { data: cases, error: caseErr }] = await Promise.all([
    supabase
      .from('composite_scores')
      .select(`award_unique_id, cas, tier, components, awards(${QUEUE_AWARD_COLS})`)
      .order('cas', { ascending: false }),
    supabase.from('case_files').select('award_unique_id'),
  ])

  if (error) throw error
  if (caseErr) throw caseErr

  const withCase = new Set((cases ?? []).map((c) => c.award_unique_id))

  return ((rows ?? []) as unknown as QueueRow[]).map((r) => ({
    award_unique_id: r.award_unique_id,
    cas: r.cas,
    tier: r.tier,
    components: r.components ?? {},
    recipient_name: r.awards?.recipient_name ?? null,
    awarding_sub_agency: r.awards?.awarding_sub_agency ?? null,
    awarding_agency: r.awards?.awarding_agency ?? null,
    obligation: r.awards?.obligation ?? null,
    naics: r.awards?.naics ?? null,
    psc: r.awards?.psc ?? null,
    fiscal_year: r.awards?.fiscal_year ?? null,
    has_case: withCase.has(r.award_unique_id),
  }))
}

// ── Lead detail ──────────────────────────────────────────────────────────────

export interface LeadDetail {
  award: Award
  entity: Entity | null
  composite: CompositeScore | null
  scores: ScoreRow[]
}

export async function fetchLead(awardUniqueId: string): Promise<LeadDetail> {
  const [awardRes, compositeRes, scoresRes] = await Promise.all([
    supabase
      .from('awards')
      .select('*, entity:entities(*)')
      .eq('award_unique_id', awardUniqueId)
      .single(),
    supabase
      .from('composite_scores')
      .select('*')
      .eq('award_unique_id', awardUniqueId)
      .maybeSingle(),
    supabase
      .from('scores')
      .select('*')
      .eq('award_unique_id', awardUniqueId)
      .order('subscore', { ascending: false }),
  ])

  if (awardRes.error) throw awardRes.error
  if (compositeRes.error) throw compositeRes.error
  if (scoresRes.error) throw scoresRes.error

  const { entity, ...award } = awardRes.data as Award & { entity: Entity | null }

  return {
    award: award as Award,
    entity: entity ?? null,
    composite: (compositeRes.data as CompositeScore | null) ?? null,
    scores: (scoresRes.data as ScoreRow[]) ?? [],
  }
}

// ── Case files ───────────────────────────────────────────────────────────────

export async function fetchCaseByAward(awardUniqueId: string): Promise<CaseFile | null> {
  const { data, error } = await supabase
    .from('case_files')
    .select('*')
    .eq('award_unique_id', awardUniqueId)
    .maybeSingle()
  if (error) throw error
  return (data as CaseFile | null) ?? null
}

export async function createCaseFile(awardUniqueId: string): Promise<CaseFile> {
  const { data, error } = await supabase
    .from('case_files')
    .insert({ award_unique_id: awardUniqueId })
    .select('*')
    .single()
  if (error) throw error
  return data as CaseFile
}

export async function assignCase(caseId: string, userId: string | null): Promise<CaseFile> {
  const { data, error } = await supabase
    .from('case_files')
    .update({ assigned_to: userId })
    .eq('id', caseId)
    .select('*')
    .single()
  if (error) throw error
  return data as CaseFile
}

export async function saveReviewerNotes(caseId: string, notes: string): Promise<CaseFile> {
  const { data, error } = await supabase
    .from('case_files')
    .update({ reviewer_notes: notes })
    .eq('id', caseId)
    .select('*')
    .single()
  if (error) throw error
  return data as CaseFile
}

export async function addEvidence(
  caseId: string,
  current: EvidenceRef[],
  ref: EvidenceRef,
): Promise<CaseFile> {
  const next = [...(current ?? []), ref]
  const { data, error } = await supabase
    .from('case_files')
    .update({ evidence: next })
    .eq('id', caseId)
    .select('*')
    .single()
  if (error) throw error
  return data as CaseFile
}

// ── The human gate (RPC-only) ────────────────────────────────────────────────
// These are the ONLY paths to a status or gate-progress change. The browser
// client cannot write those columns directly — the column GRANT denies it and
// the case_files_gate_guard trigger rejects any change not made through these
// SECURITY DEFINER functions. This is the human gate, enforced in software.

export async function clearGate(
  caseId: string,
  gateKey: string,
  clearedBy: string | null,
  note: string | null,
): Promise<CaseFile> {
  const { data, error } = await supabase.rpc('clear_case_gate', {
    p_case_id: caseId,
    p_gate_key: gateKey,
    p_cleared_by: clearedBy,
    p_note: note,
  })
  if (error) throw error
  return data as CaseFile
}

export async function advanceStatus(
  caseId: string,
  newStatus: CaseStatus,
  note: string | null,
): Promise<CaseFile> {
  const { data, error } = await supabase.rpc('advance_case_status', {
    p_case_id: caseId,
    p_new_status: newStatus,
    p_note: note,
  })
  if (error) throw error
  return data as CaseFile
}
