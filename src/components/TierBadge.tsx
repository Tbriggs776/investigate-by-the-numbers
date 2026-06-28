import type { Tier } from '../lib/types'
import { TIER_META } from '../lib/reference'

export default function TierBadge({ tier, title }: { tier: Tier; title?: boolean }) {
  const meta = TIER_META[tier]
  return (
    <span
      className={`badge tier-${tier}`}
      title={title ? `${meta.range} · ${meta.blurb}` : undefined}
    >
      {meta.label}
    </span>
  )
}
