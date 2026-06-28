import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Gate every reviewer route behind a session. This is convenience, not the
 * security boundary — Row-Level Security already returns nothing to an anon
 * client. Even a bypassed route renders empty.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="screen-center muted">Loading…</div>
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
