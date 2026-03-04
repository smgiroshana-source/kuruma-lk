// ============================================================
// FILE: src/app/forgot-password/page.tsx
// NEW FILE
// FEATURE: 7 (Forgot password flow)
// ============================================================

'use client'

import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json()

      if (json.success) {
        setSent(true)
      } else {
        setError(json.error || 'Something went wrong')
      }
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="text-3xl font-black text-orange-500">kuruma.lk</a>
          <p className="text-sm text-slate-500 mt-2">Reset your password</p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <div className="text-4xl mb-3">📧</div>
            <h2 className="font-bold text-lg text-slate-900 mb-2">Check Your Email</h2>
            <p className="text-sm text-slate-500 mb-4">
              We sent a password reset link to <strong className="text-slate-700">{email}</strong>.
              Click the link in the email to reset your password.
            </p>
            <p className="text-xs text-slate-400 mb-4">
              Didn&apos;t get it? Check spam or wait a minute, then try again.
            </p>
            <div className="space-y-2">
              <button onClick={() => { setSent(false); setEmail('') }}
                className="w-full text-sm font-semibold text-orange-500 py-2 rounded-lg border border-orange-200 hover:bg-orange-50 transition">
                Try a Different Email
              </button>
              <a href="/login"
                className="block w-full text-sm text-slate-400 hover:text-slate-600 py-2">
                Back to Login
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <p className="text-sm text-slate-500">
              Enter the email address associated with your account.
              We&apos;ll send you a link to reset your password.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email Address</label>
              <input
                type="email" required autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition"
                placeholder="your@email.com"
              />
            </div>
            {error && (
              <p className="text-red-500 text-sm font-semibold bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}
            <button type="submit" disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <div className="text-center">
              <a href="/login" className="text-xs text-slate-400 hover:text-slate-600">
                Back to Login
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
