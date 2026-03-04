import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase())
  const isAdmin = adminEmails.includes(data.user?.email?.toLowerCase() || '')

  return NextResponse.json({ success: true, redirect: isAdmin ? '/admin' : '/vendor' })
}
