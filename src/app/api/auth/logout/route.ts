import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerSupabase()
  await supabase.auth.signOut()
  const response = NextResponse.json({ success: true })
  response.cookies.set('kuruma_role', '', { path: '/', maxAge: 0 })
  return response
}
