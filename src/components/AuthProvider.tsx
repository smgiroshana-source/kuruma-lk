'use client'

import { createContext, useContext, useEffect, useState } from 'react'
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

// Read a cookie by name (client-side, non-httpOnly cookies only)
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'))
  return match ? decodeURIComponent(match[2]) : null
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${days * 86400};samesite=lax`
}

function deleteCookie(name: string) {
  if (typeof document === 'undefined') return
  document.cookie = `${name}=;path=/;max-age=0`
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialize from cookie for hint, but mark as loading until API confirms
  const cachedRole = getCookie('kuruma_role') as Role | null

  const [state, setState] = useState<Omit<AuthContextType, 'signOut'>>({
    user: cachedRole ? { id: 'cached' } : null,
    role: cachedRole || 'customer',
    vendor: null,
    isAdmin: cachedRole === 'admin',
    loading: !!cachedRole, // If cookie exists, wait for API to confirm before showing buttons
  })
  const supabase = createClient()

  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch('/api/auth/check-vendor')
        if (res.ok) {
          const json = await res.json()
          if (json.user) {
            const email = json.user.email || ''
            if (ADMIN_EMAILS.includes(email)) {
              setCookie('kuruma_role', 'admin')
              setState({ user: json.user, role: 'admin', vendor: null, isAdmin: true, loading: false })
              return
            }
            if (json.vendor && json.vendor.status === 'approved') {
              setCookie('kuruma_role', 'vendor')
              setState({ user: json.user, role: 'vendor', vendor: json.vendor, isAdmin: false, loading: false })
              return
            }
            setCookie('kuruma_role', 'customer')
            setState({ user: json.user, role: 'customer', vendor: json.vendor, isAdmin: false, loading: false })
            return
          }
        }
        deleteCookie('kuruma_role')
        setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
      } catch {
        deleteCookie('kuruma_role')
        setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
      }
    }

    detect()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => detect())
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    deleteCookie('kuruma_role')
    setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
