// ============================================================
// FILE: src/app/login/page.tsx
// REPLACES: the entire existing file
// FEATURE: 7 (Added "Forgot your password?" link)
// ============================================================

'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const json = await res.json()

      if (json.success) {
        window.location.href = json.redirect
      } else {
        setError(json.error || 'Login failed')
      }
    } catch {
      setError('Network error')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="text-3xl font-black text-orange-500">kuruma.lk</a>
          <p className="text-sm text-slate-500 mt-2">Log in to your account</p>
        </div>
        <form onSubmit={handleLogin} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Email</label><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="your@email.com" /></div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Password</label><input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition" placeholder="Your password" /></div>
          {error && <p className="text-red-500 text-sm font-semibold bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">{loading ? 'Logging in...' : 'Log In'}</button>

          {/* ─── [NEW] Forgot Password Link ─── */}
          <p className="text-center">
            <a href="/forgot-password" className="text-xs text-orange-500 font-semibold hover:text-orange-600">
              Forgot your password?
            </a>
          </p>

          <div className="text-center space-y-2">
            <p className="text-xs text-slate-400">Want to sell parts? <a href="/register" className="text-orange-500 font-semibold">Register Your Shop</a></p>
            <p className="text-xs text-slate-400"><a href="/" className="text-slate-500 hover:text-slate-700">Back to Marketplace</a></p>
          </div>
        </form>
      </div>
    </div>
  )
}
