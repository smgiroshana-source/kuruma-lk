import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createServerSupabase()
  // This device only — see AuthProvider.signOut (2026-10-23)
  await supabase.auth.signOut({ scope: 'local' })
  return NextResponse.json({ success: true })
}
