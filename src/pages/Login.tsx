import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface LocationState {
  from?: { pathname?: string }
}

export default function Login() {
  const { session, signIn } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (session) {
    const dest = (location.state as LocationState | null)?.from?.pathname ?? '/'
    return <Navigate to={dest} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="screen-center">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="login-brand">
          <div className="login-kicker">Investigate by the Numbers</div>
          <h1>Review Console</h1>
          <p className="muted">
            Internal investigative tool. Authorized reviewers only.
          </p>
        </div>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="alert">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-foot muted">
          The anomaly score is a prioritization signal, never a finding.
        </p>
      </form>
    </div>
  )
}
