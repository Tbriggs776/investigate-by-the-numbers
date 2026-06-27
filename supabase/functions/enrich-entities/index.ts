// Supabase Edge Function: enrich-entities  (Phase 2)
// Enriches stub entities from SAM.gov: registration dates, CAGE, address,
// socioeconomic/business types, exclusion flag — then geocodes the physical
// address via the Census geocoder. Sets enrichment_status='enriched'.
//
// SAM key is read from Vault ('sam_api_key') via the service-role-only
// get_vault_secret RPC, with a Deno.env('SAM_API_KEY') fallback.
//
// Body (optional): { maxEntities=200, concurrency=4, onlyStubs=true }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const SAM = 'https://api.sam.gov/entity-information/v3/entities'
const CENSUS = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

async function getSamKey(supabase: any): Promise<string> {
  try {
    const { data } = await supabase.rpc('get_vault_secret', { p_name: 'sam_api_key' })
    if (data) return data
  } catch (_) { /* fall through */ }
  return Deno.env.get('SAM_API_KEY') || ''
}

async function fetchSam(key: string, uei: string): Promise<any | null> {
  try {
    const url = `${SAM}?api_key=${encodeURIComponent(key)}&ueiSAM=${encodeURIComponent(uei)}`
    const res = await fetch(url)
    if (res.status === 429) return 'THROTTLED'  // SAM daily quota exhausted
    if (!res.ok) return null
    const d = await res.json()
    return d?.entityData?.[0] || null
  } catch {
    return null
  }
}

function normAddr(a: any): string | null {
  if (!a) return null
  const tail = `${a.stateOrProvinceCode || ''} ${a.zipCode || ''}`.trim()
  return [a.addressLine1, a.city, tail].filter(Boolean).join(', ').toUpperCase() || null
}

async function geocode(a: any): Promise<{ lat: number | null; lon: number | null; precision: string }> {
  if (!a?.addressLine1 || !a?.city || !a?.stateOrProvinceCode || a?.countryCode !== 'USA') {
    return { lat: null, lon: null, precision: 'none' }
  }
  try {
    const oneline = `${a.addressLine1}, ${a.city}, ${a.stateOrProvinceCode} ${a.zipCode || ''}`.trim()
    const url = `${CENSUS}?address=${encodeURIComponent(oneline)}&benchmark=Public_AR_Current&format=json`
    const res = await fetch(url)
    if (!res.ok) return { lat: null, lon: null, precision: 'none' }
    const d = await res.json()
    const m = d?.result?.addressMatches?.[0]
    if (!m?.coordinates) return { lat: null, lon: null, precision: 'none' }
    return { lat: m.coordinates.y ?? null, lon: m.coordinates.x ?? null, precision: 'address' }
  } catch {
    return { lat: null, lon: null, precision: 'none' }
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
    const maxEntities = body.maxEntities ?? 200
    const concurrency = body.concurrency ?? 4
    const onlyStubs = body.onlyStubs ?? true

    const samKey = await getSamKey(supabase)
    if (!samKey) throw new Error('SAM key not configured (Vault sam_api_key / SAM_API_KEY)')

    let q = supabase.from('entities').select('uei').order('created_at', { ascending: true }).limit(maxEntities)
    if (onlyStubs) q = q.eq('enrichment_status', 'stub')
    const { data: targets, error: selErr } = await q
    if (selErr) throw new Error(`select entities: ${selErr.message}`)

    const nowIso = new Date().toISOString()
    let samMisses = 0, geocoded = 0, throttled = false

    const enrichedRows = (await mapLimit(targets || [], concurrency, async (t: any) => {
      if (throttled) return null  // quota hit; stop burning attempts
      const ed = await fetchSam(samKey, t.uei)
      if (ed === 'THROTTLED') { throttled = true; return null }
      if (!ed) { samMisses++; return null }
      const reg = ed.entityRegistration || {}
      const core = ed.coreData || {}
      const phys = core.physicalAddress || {}
      const geo = await geocode(phys)
      if (geo.lat !== null) geocoded++
      return {
        uei: t.uei,
        legal_name: reg.legalBusinessName || null,
        cage_code: reg.cageCode || null,
        registration_date: reg.registrationDate || null,
        initial_registration_date: reg.registrationDate || null,
        registration_status: reg.registrationStatus || null,
        registration_expiration_date: reg.registrationExpirationDate || null,
        exclusion_flag: reg.exclusionStatusFlag ? reg.exclusionStatusFlag === 'Y' : null,
        address_line1: phys.addressLine1 || null,
        address_line2: phys.addressLine2 || null,
        city: phys.city || null,
        state: phys.stateOrProvinceCode || null,
        zip: phys.zipCode || null,
        address_normalized: normAddr(phys),
        latitude: geo.lat,
        longitude: geo.lon,
        geocode_precision: geo.precision,
        socioeconomic: { businessTypes: core.businessTypes ?? null },
        naics_primary: core.entityInformation?.primaryNaics || null,
        source: 'SAM.gov',
        enrichment_status: 'enriched',
        enriched_at: nowIso,
      }
    })).filter(Boolean)

    if (enrichedRows.length) {
      const { error } = await supabase.from('entities').upsert(enrichedRows, { onConflict: 'uei' })
      if (error) throw new Error(`entities upsert: ${error.message}`)
    }

    return new Response(JSON.stringify({
      ok: true,
      targeted: targets?.length || 0,
      enriched: enrichedRows.length,
      samMisses,
      geocoded,
      throttled,
      note: throttled ? 'SAM daily quota hit; re-run after reset (onlyStubs=true) to finish remaining stubs' : undefined,
      durationMs: Date.now() - started,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }
})
