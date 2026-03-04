// ============================================================
// FILE: src/app/reset-password/page.tsx
// NEW FILE
// FEATURE: 7 (Reset password after clicking email link)
// ============================================================

'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    // Supabase auto-detects the recovery token from the URL hash
    // and creates a session. We just need to wait for it.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setSessionReady(true)
      }
    })

    // Check if there's already a session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true)
    })

    // Give it a moment to process the URL token
    const timeout = setTimeout(() => {
      if (!sessionReady) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session) {
            setSessionReady(true)
          } else {
            setError('Invalid or expired reset link. Please request a new one.')
          }
        })
      }
    }, 3000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })

      if (updateError) {
        setError(updateError.message)
      } else {
        setSuccess(true)
        // Sign out so they can log in fresh with new password
        await supabase.auth.signOut()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <a href="/" className="text-3xl font-black text-orange-500">kuruma.lk</a>
          <p className="text-sm text-slate-500 mt-2">Set a new password</p>
        </div>

        {success ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <div className="text-4xl mb-3">✅</div>
            <h2 className="font-bold text-lg text-slate-900 mb-2">Password Updated!</h2>
            <p className="text-sm text-slate-500 mb-4">
              Your password has been changed successfully. You can now log in with your new password.
            </p>
            <a href="/login"
              className="block w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition text-center text-sm">
              Go to Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleReset} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            {!sessionReady && !error && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                Verifying reset link...
              </div>
            )}

            {sessionReady && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">New Password</label>
                  <input
                    type="password" required autoFocus
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition"
                    placeholder="At least 6 characters"
                    minLength={6}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Confirm New Password</label>
                  <input
                    type="password" required
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition"
                    placeholder="Type password again"
                  />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition disabled:opacity-50">
                  {loading ? 'Updating...' : 'Set New Password'}
                </button>
              </>
            )}

            {error && (
              <div>
                <p className="text-red-500 text-sm font-semibold bg-red-50 px-3 py-2 rounded-lg mb-2">{error}</p>
                <a href="/forgot-password" className="text-xs text-orange-500 font-semibold">
                  Request a new reset link →
                </a>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
