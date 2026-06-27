// Supabase Edge Function: ingest-awards  (Phase 1)
// Pulls contract awards for the config-defined test slice from USAspending and
// idempotently upserts into raw_awards + awards (+ entity stubs), honoring the
// 0010 ingestion contracts:
//   - entity stub upserted first (FK), DO NOTHING so it never downgrades Phase-2
//     enrichment; raw_awards second (FK); awards third.
//   - awards is summary-grain; fiscal_year is a GENERATED column (never set here).
//   - raw_recipient_uei preserves the source UEI; awards.uei is the resolved FK.
//
// Two-stage: spending_by_award search (paginated) -> award detail (FPDS fields).
// DB writes use the service role. This function touches ONLY data tables; it never
// references case_files, so it cannot reach the human gate. (A dedicated restricted
// ingest role is the planned hardening before gate-adjacent agents are built.)
//
// Body (all optional): { maxAwards=150, pageLimit=50, detailConcurrency=8 }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const USA = 'https://api.usaspending.gov/api/v2'
const CONTRACT_TYPES = ['A', 'B', 'C', 'D']
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Federal FY N = Oct 1 (N-1) .. Sep 30 (N)
function fyRange(fy: number) {
  return { start: `${fy - 1}-10-01`, end: `${fy}-09-30` }
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function int(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : Math.trunc(n)
}
// "TECHNOLOGY ACQUISITION CENTER NJ (36C10B)" -> "36C10B"
function officeCode(name: string | null): string | null {
  if (!name) return null
  const m = name.match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : null
}

async function searchPage(filters: unknown, page: number, limit: number) {
  const res = await fetch(`${USA}/search/spending_by_award/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters,
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'generated_internal_id'],
      page, limit, sort: 'Award Amount', order: 'desc', subawards: false,
    }),
  })
  if (!res.ok) throw new Error(`search page ${page}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return await res.json()
}

async function fetchDetail(genId: string): Promise<any | null> {
  try {
    const res = await fetch(`${USA}/awards/${encodeURIComponent(genId)}/`, {
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function normalizeAward(d: any) {
  const aw = d.awarding_agency || {}
  const fa = d.funding_agency || {}
  const lt = d.latest_transaction_contract_data || {}
  const pop = d.place_of_performance || {}
  const rec = d.recipient || {}
  const perf = d.period_of_performance || {}
  const uei = rec.recipient_uei || null
  return {
    award_unique_id: d.generated_unique_award_id,
    uei,
    raw_recipient_uei: uei,
    recipient_name: rec.recipient_name || null,
    awarding_agency: aw.toptier_agency?.name || null,
    awarding_sub_agency: aw.subtier_agency?.name || null,
    awarding_office_name: aw.office_agency_name || null,
    awarding_office_code: officeCode(aw.office_agency_name || null),
    funding_agency: fa.toptier_agency?.name || null,
    funding_sub_agency: fa.subtier_agency?.name || null,
    funding_office_name: fa.office_agency_name || null,
    funding_office_code: officeCode(fa.office_agency_name || null),
    obligation: num(d.total_obligation),
    base_value: num(d.base_exercised_options),
    current_total_value: num(d.base_and_all_options),
    action_date: d.date_signed || null,
    period_of_performance_start: perf.start_date || null,
    period_of_performance_end: perf.end_date || null,
    naics: lt.naics || null,
    naics_description: lt.naics_description || null,
    psc: lt.product_or_service_code || null,
    psc_description: lt.product_or_service_description || null,
    extent_competed: lt.extent_competed || null,
    offers_received: int(lt.number_of_offers_received),
    set_aside_type: lt.type_set_aside || null,
    type_of_contract_pricing: lt.type_of_contract_pricing || null,
    solicitation_procedures: lt.solicitation_procedures || null,
    other_than_full_and_open_competition: lt.other_than_full_and_open || null,
    parent_award_id: d.parent_award?.generated_unique_award_id || null,
    base_award_unique_key: d.piid || null,
    piid: d.piid || null,
    modification_number: null, // transaction-grain; not set at summary grain
    place_of_performance_state: pop.state_code || null,
    place_of_performance_zip: pop.zip5 || null,
    place_of_performance_country_code: pop.location_country_code || null,
    place_of_performance_city: pop.city_name || null,
    place_of_performance_county: pop.county_name || null,
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const started = Date.now()
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json().catch(() => ({}))
    const maxAwards = body.maxAwards ?? 150
    const pageLimit = body.pageLimit ?? 50
    const detailConcurrency = body.detailConcurrency ?? 8

    // Slice from config (config-driven, never hardcoded).
    const { data: cfg, error: cfgErr } = await supabase
      .from('config').select('value').eq('key', 'test_slice').single()
    if (cfgErr) throw new Error(`config.test_slice: ${cfgErr.message}`)
    const slice = cfg.value as { agency: string; naics: string; fiscal_year: number }
    const { start, end } = fyRange(slice.fiscal_year)
    const filters = {
      time_period: [{ start_date: start, end_date: end, date_type: 'action_date' }],
      agencies: [{ type: 'awarding', tier: 'toptier', name: slice.agency }],
      naics_codes: [slice.naics],
      award_type_codes: CONTRACT_TYPES,
    }

    // 1) paginate search -> generated ids (bounded by maxAwards).
    const ids: string[] = []
    let page = 1, pagesFetched = 0, hasNext = true
    while (hasNext && ids.length < maxAwards) {
      const res = await searchPage(filters, page, pageLimit)
      pagesFetched++
      for (const r of (res.results || [])) {
        if (r.generated_internal_id) ids.push(r.generated_internal_id)
        if (ids.length >= maxAwards) break
      }
      hasNext = !!res.page_metadata?.hasNext
      page++
    }

    // 2) fetch details + normalize (concurrency-limited).
    const details = (await mapLimit(ids, detailConcurrency, fetchDetail)).filter(Boolean)

    const entitiesMap = new Map<string, any>()
    const rawRows: any[] = []
    const awardRows: any[] = []
    const nowIso = new Date().toISOString()
    for (const d of details) {
      const norm = normalizeAward(d)
      if (!norm.award_unique_id) continue
      if (norm.uei && !entitiesMap.has(norm.uei)) {
        entitiesMap.set(norm.uei, {
          uei: norm.uei,
          legal_name: norm.recipient_name,
          source: 'USAspending-stub',
          enrichment_status: 'stub',
        })
      }
      rawRows.push({
        award_unique_id: norm.award_unique_id,
        raw: d,
        piid: norm.piid,
        uei: norm.uei,
        source: 'USAspending',
        fetched_at: nowIso,
      })
      awardRows.push(norm)
    }

    // 3) upsert in FK order: entities (DO NOTHING) -> raw_awards -> awards.
    const entityRows = [...entitiesMap.values()]
    if (entityRows.length) {
      const { error } = await supabase.from('entities')
        .upsert(entityRows, { onConflict: 'uei', ignoreDuplicates: true })
      if (error) throw new Error(`entities upsert: ${error.message}`)
    }
    if (rawRows.length) {
      const { error } = await supabase.from('raw_awards')
        .upsert(rawRows, { onConflict: 'award_unique_id' })
      if (error) throw new Error(`raw_awards upsert: ${error.message}`)
    }
    if (awardRows.length) {
      const { error } = await supabase.from('awards')
        .upsert(awardRows, { onConflict: 'award_unique_id' })
      if (error) throw new Error(`awards upsert: ${error.message}`)
    }

    return new Response(JSON.stringify({
      ok: true,
      slice,
      fyRange: { start, end },
      pagesFetched,
      awardsSeen: ids.length,
      detailsFetched: details.length,
      entitiesUpserted: entityRows.length,
      awardsUpserted: awardRows.length,
      durationMs: Date.now() - started,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
