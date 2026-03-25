'use client'

import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/constants'

type Role = 'customer' | 'vendor' | 'admin'

type AuthContextType = {
  user: any | null
  role: Role
  vendor: any | null
  isAdmin: boolean
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: 'customer',
  vendor: null,
  isAdmin: false,
  loading: true,
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthContextType, 'signOut'>>({
    user: null,
    role: 'customer',
    vendor: null,
    isAdmin: false,
    loading: true,
  })
  const supabase = createClient()
  const signingOut = useRef(false)

  useEffect(() => {
    async function detect() {
      // Don't re-detect if we're in the middle of signing out
      if (signingOut.current) return

      try {
        // Use server API to check auth — it reads httpOnly cookies reliably
        const res = await fetch('/api/auth/check-vendor')
        if (res.ok) {
          const json = await res.json()
          if (json.user) {
            const email = json.user.email || ''
            if (ADMIN_EMAILS.includes(email)) {
              setState({ user: json.user, role: 'admin', vendor: null, isAdmin: true, loading: false })
              return
            }
            if (json.vendor && json.vendor.status === 'approved') {
              setState({ user: json.user, role: 'vendor', vendor: json.vendor, isAdmin: false, loading: false })
              return
            }
            setState({ user: json.user, role: 'customer', vendor: json.vendor, isAdmin: false, loading: false })
            return
          }
        }
      } catch {}
      setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
    }

    detect()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
        return
      }
      detect()
    })
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    signingOut.current = true
    setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
    // Clear server-side cookies via API
    await fetch('/api/auth/logout', { method: 'POST' })
    // Clear client-side session
    await supabase.auth.signOut()
    signingOut.current = false
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
