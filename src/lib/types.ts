// Database row shapes. These mirror the public schema (migrations 0001–0016).
// numeric columns arrive from PostgREST as strings; we keep them as strings and
// parse at the formatting boundary to avoid silent float drift.

export type Tier = 'monitor' | 'review' | 'investigation'
export type CaseStatus = 'queue' | 'hold' | 'kill' | 'publish'

/** A single scorer's contribution inside composite_scores.components. */
export interface ComponentEntry {
  weight: number
  subscore: number
}

export interface CompositeScore {
  award_unique_id: string
  cas: string
  tier: Tier
  components: Record<string, ComponentEntry>
  scored_at: string
}

export interface ScoreRow {
  id: string
  award_unique_id: string
  scorer_name: string
  subscore: string
  inputs: Record<string, unknown> & { note?: string }
  scored_at: string
}

export interface Award {
  award_unique_id: string
  uei: string | null
  recipient_name: string | null
  awarding_agency: string | null
  awarding_sub_agency: string | null
  funding_agency: string | null
  funding_sub_agency: string | null
  obligation: string | null
  base_value: string | null
  current_total_value: string | null
  action_date: string | null
  period_of_performance_start: string | null
  period_of_performance_end: string | null
  naics: string | null
  naics_description: string | null
  psc: string | null
  psc_description: string | null
  extent_competed: string | null
  offers_received: number | null
  set_aside_type: string | null
  type_of_contract_pricing: string | null
  parent_award_id: string | null
  modification_number: string | null
  place_of_performance_state: string | null
  place_of_performance_zip: string | null
  fiscal_year: number | null
  raw_recipient_uei: string | null
  piid: string | null
  base_award_unique_key: string | null
  awarding_office_code: string | null
  awarding_office_name: string | null
  funding_office_code: string | null
  funding_office_name: string | null
  place_of_performance_country_code: string | null
  place_of_performance_city: string | null
  place_of_performance_county: string | null
  solicitation_procedures: string | null
  other_than_full_and_open_competition: string | null
}

export interface Entity {
  uei: string
  legal_name: string | null
  registration_status: string | null
  registration_date: string | null
  registration_expiration_date: string | null
  initial_registration_date: string | null
  cage_code: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  address_normalized: string | null
  latitude: string | null
  longitude: string | null
  geocode_precision: string | null
  socioeconomic: Record<string, unknown> | null
  naics_primary: string | null
  prior_uei: string | null
  prior_duns: string | null
  exclusion_flag: boolean | null
  enrichment_status: string | null
  enriched_at: string | null
  source: string | null
}

/** A sourced evidence reference appended to a case (agents or humans). */
export interface EvidenceRef {
  source: string
  detail?: string
  url?: string
  added_by?: string
  added_at?: string
}

/** One cleared verification gate inside case_files.gate_progress. */
export interface GateClearance {
  cleared_by?: string | null
  cleared_at?: string | null
  note?: string | null
}

export interface CaseFile {
  id: string
  award_unique_id: string
  status: CaseStatus
  gate_progress: Record<string, GateClearance>
  reviewer_notes: string | null
  evidence: EvidenceRef[]
  assigned_to: string | null
  created_at: string
  updated_at: string
}

/** A queue row: composite score joined to its award + (optional) entity. */
export interface QueueLead {
  award_unique_id: string
  cas: string
  tier: Tier
  components: Record<string, ComponentEntry>
  recipient_name: string | null
  awarding_sub_agency: string | null
  awarding_agency: string | null
  obligation: string | null
  naics: string | null
  psc: string | null
  fiscal_year: number | null
  has_case: boolean
}
