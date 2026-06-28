import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">ibtn</span>
            <span className="brand-text">
              Investigate <span className="brand-thin">by the Numbers</span>
            </span>
          </Link>

          <nav className="app-nav">
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              Queue
            </NavLink>
          </nav>

          <div className="app-user">
            <span className="muted mono small">{user?.email}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        </div>
        <div className="app-header-rule" />
      </header>

      <main className="app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <span>
          Internal investigative infrastructure. The anomaly score is a
          prioritization signal, never a finding. A human clears every gate.
        </span>
      </footer>
    </div>
  )
}
