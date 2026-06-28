// Formatting helpers. Money/dates/codes render consistently and defensively —
// PostgREST hands numerics back as strings, and most award fields are nullable.

const DASH = '—'

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Compact money for tight spaces: $2.6M, $105.4M, $452K. */
export function moneyCompact(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

export function num(value: string | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || value === '') return DASH
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return DASH
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function date(value: string | null | undefined): string {
  if (!value) return DASH
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return DASH
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH
  return String(value)
}

/** Turn an inputs key like `noncompeted_share` into `Noncompeted share`. */
export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** USAspending public award page. award_unique_id IS the generated_unique_award_id. */
export function usaspendingUrl(awardUniqueId: string): string {
  return `https://www.usaspending.gov/award/${encodeURIComponent(awardUniqueId)}`
}

/** SAM.gov public entity lookup by UEI. */
export function samUrl(uei: string): string {
  return `https://sam.gov/search/?index=ei&q=${encodeURIComponent(uei)}`
}

/** A short, stable label for an award when no recipient name is present. */
export function awardShortId(awardUniqueId: string): string {
  // generated_unique_award_id is long; show the last meaningful segment.
  const parts = awardUniqueId.split('_')
  return parts[parts.length - 1] || awardUniqueId
}
