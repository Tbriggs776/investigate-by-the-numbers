import type { CaseStatus } from '../lib/types'
import { STATUS_META } from '../lib/reference'

export default function StatusBadge({ status }: { status: CaseStatus }) {
  const meta = STATUS_META[status]
  return (
    <span className={`badge status-${status}`} title={meta?.blurb}>
      {meta?.label ?? status}
    </span>
  )
}
