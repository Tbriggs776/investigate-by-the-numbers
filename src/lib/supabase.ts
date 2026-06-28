import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  )
}

// The browser client carries only the publishable (anon) key. All data access
// runs under the signed-in reviewer's `authenticated` role; Row-Level Security
// and the case_files column grants — not the client — are what enforce the
// human gate. This client can NEVER write case_files.status / gate_progress
// directly; those go through the advance_case_status / clear_case_gate RPCs.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
