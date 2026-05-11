import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const ALLOWED_DOMAIN = 'supersheldon.com'

export default function Login() {
  const { user } = useAuth()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    const domain = email.trim().split('@')[1]?.toLowerCase()
    if (domain !== ALLOWED_DOMAIN) {
      setError(`Only @${ALLOWED_DOMAIN} accounts are allowed.`)
      return
    }

    setLoading(true)

    // Try sign in first
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (!signInErr) {
      // Success — AuthContext listener will update user, redirect happens via <Navigate>
      setLoading(false)
      return
    }

    // If credentials wrong, try registering (first-time login sets their password)
    if (signInErr.message.toLowerCase().includes('invalid login credentials')) {
      const { error: signUpErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })

      if (!signUpErr) {
        // First-time user registered and auto-signed in
        setLoading(false)
        return
      }

      // Already registered but wrong password
      if (signUpErr.message.toLowerCase().includes('already registered')) {
        setError('Incorrect password. Try again.')
      } else {
        setError(signUpErr.message)
      }
    } else {
      setError(signInErr.message)
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0d1117] to-[#05070a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-900/50 mb-4">
            <span className="text-white text-lg font-black">CA</span>
          </div>
          <h1 className="text-white text-2xl font-black tracking-tight">Call Audit</h1>
          <p className="text-white/30 text-sm font-medium mt-1">SuperSheldon · Internal tool</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-7 shadow-2xl">
          <h2 className="text-white font-bold text-base mb-1">Sign in</h2>
          <p className="text-white/40 text-xs font-medium mb-6">
            Use your <span className="text-white/60">@{ALLOWED_DOMAIN}</span> email
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-white/50 text-xs font-bold uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={`you@${ALLOWED_DOMAIN}`}
                required
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-emerald-500/60 focus:bg-white/8 transition-all"
              />
            </div>

            <div>
              <label className="block text-white/50 text-xs font-bold uppercase tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder-white/20 focus:outline-none focus:border-emerald-500/60 focus:bg-white/8 transition-all"
              />
              <p className="text-white/25 text-[11px] mt-1.5 font-medium">
                First time? Your password will be set permanently on first login.
              </p>
            </div>

            {error && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-xs font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold py-2.5 rounded-xl shadow-lg shadow-emerald-900/30 transition-all duration-200 mt-2"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-white/15 text-xs font-medium mt-6">
          Access restricted to SuperSheldon employees
        </p>
      </div>
    </div>
  )
}
