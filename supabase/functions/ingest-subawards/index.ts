// Supabase Edge Function: ingest-subawards  (Phase 1 follow-on / PASSTHRU data)
// Pulls FSRS sub-award rows for the config slice from USAspending and idempotently
// upserts into subawards, linking each to its prime via prime_award_generated_internal_id
// (= awards.award_unique_id). Subawards whose prime is not in `awards` are skipped to
// respect the NOT NULL FK (we only ingested A/B/C/D primes).
//
// Idempotency: subaward_unique_id = `${prime}:${subAwardId}` (stable, collision-safe);
// the subawards trigger derives natural_key from it; upsert targets natural_key.
//
// Body (optional): { maxSubawards=3000, pageLimit=100 }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const USA = 'https://api.usaspending.gov/api/v2'
const CONTRACT_TYPES = ['A', 'B', 'C', 'D']
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function fyRange(fy: number) {
  return { start: `${fy - 1}-10-01`, end: `${fy}-09-30` }
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function searchSubawardPage(filters: unknown, page: number, limit: number) {
  const res = await fetch(`${USA}/search/spending_by_award/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters,
      fields: ['Sub-Award ID', 'Sub-Awardee Name', 'Sub-Award Amount', 'Sub-Award Date', 'Prime Award ID'],
      page, limit, sort: 'Sub-Award Amount', order: 'desc', subawards: true,
    }),
  })
  if (!res.ok) throw new Error(`subaward page ${page}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return await res.json()
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
    const maxSubawards = body.maxSubawards ?? 3000
    const pageLimit = body.pageLimit ?? 100

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

    // 1) paginate the subaward feed.
    const raw: any[] = []
    let page = 1, pagesFetched = 0, hasNext = true
    while (hasNext && raw.length < maxSubawards) {
      const res = await searchSubawardPage(filters, page, pageLimit)
      pagesFetched++
      for (const r of (res.results || [])) {
        raw.push(r)
        if (raw.length >= maxSubawards) break
      }
      hasNext = !!res.page_metadata?.hasNext
      page++
    }

    // 2) which primes do we actually hold? (FK is NOT NULL; skip orphans.)
    const primeIds = [...new Set(raw.map((r) => r.prime_award_generated_internal_id).filter(Boolean))]
    const knownPrimes = new Set<string>()
    // chunk the IN() to stay within URL limits
    for (let i = 0; i < primeIds.length; i += 200) {
      const chunk = primeIds.slice(i, i + 200)
      const { data, error } = await supabase
        .from('awards').select('award_unique_id').in('award_unique_id', chunk)
      if (error) throw new Error(`awards lookup: ${error.message}`)
      for (const a of (data || [])) knownPrimes.add(a.award_unique_id)
    }

    // 3) build dedup'd subaward rows for known primes.
    const seen = new Set<string>()
    const rows: any[] = []
    let orphanSkipped = 0
    for (const r of raw) {
      const prime = r.prime_award_generated_internal_id
      const subId = r['Sub-Award ID']
      if (!prime || !subId) continue
      if (!knownPrimes.has(prime)) { orphanSkipped++; continue }
      const key = `${prime}:${subId}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        subaward_unique_id: key,
        parent_award_id: prime,
        prime_award_unique_key: prime,
        subaward_number: String(subId),
        sub_recipient_name: r['Sub-Awardee Name'] || null,
        amount: num(r['Sub-Award Amount']),
        action_date: r['Sub-Award Date'] || null,
      })
    }

    // 4) idempotent upsert (trigger derives natural_key from subaward_unique_id).
    let upserted = 0
    if (rows.length) {
      const { error } = await supabase.from('subawards')
        .upsert(rows, { onConflict: 'natural_key' })
      if (error) throw new Error(`subawards upsert: ${error.message}`)
      upserted = rows.length
    }

    return new Response(JSON.stringify({
      ok: true,
      slice,
      pagesFetched,
      subawardsSeen: raw.length,
      knownPrimes: knownPrimes.size,
      orphanSkipped,
      upserted,
      durationMs: Date.now() - started,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
