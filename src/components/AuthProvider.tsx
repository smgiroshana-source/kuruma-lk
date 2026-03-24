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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthContextType, 'signOut'>>({
    user: null,
    role: 'customer',
    vendor: null,
    isAdmin: false,
    loading: true,
  })
  const supabase = createClient()

  useEffect(() => {
    async function detect() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
        return
      }

      const email = user.email || ''

      // Check 1: Is this the Super Admin?
      if (ADMIN_EMAILS.includes(email)) {
        setState({ user, role: 'admin', vendor: null, isAdmin: true, loading: false })
        return
      }

      // Check 2: Is this a Shop Owner?
      // Try client-side first, fallback to API if RLS blocks
      let vendor = null
      try {
        const { data } = await supabase
          .from('vendors')
          .select('*')
          .eq('user_id', user.id)
          .single()
        vendor = data
      } catch {}

      // If client query returned nothing, try via API (bypasses RLS)
      if (!vendor) {
        try {
          const res = await fetch('/api/auth/check-vendor')
          if (res.ok) {
            const json = await res.json()
            vendor = json.vendor
          }
        } catch {}
      }

      if (vendor && vendor.status === 'approved') {
        setState({ user, role: 'vendor', vendor, isAdmin: false, loading: false })
      } else {
        setState({ user, role: 'customer', vendor, isAdmin: false, loading: false })
      }
    }

    detect()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => detect())
    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
