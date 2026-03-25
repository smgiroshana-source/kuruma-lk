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

      if (ADMIN_EMAILS.includes(email)) {
        setState({ user, role: 'admin', vendor: null, isAdmin: true, loading: false })
        return
      }

      // Check if vendor
      const { data: vendor } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (vendor && vendor.status === 'approved') {
        setState({ user, role: 'vendor', vendor, isAdmin: false, loading: false })
      } else {
        setState({ user, role: 'customer', vendor, isAdmin: false, loading: false })
      }
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
    setState({ user: null, role: 'customer', vendor: null, isAdmin: false, loading: false })
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ ...state, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
