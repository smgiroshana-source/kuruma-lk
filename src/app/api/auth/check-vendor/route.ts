import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ vendor: null })

  const admin = createAdminClient()
  const { data: vendor } = await admin
    .from('vendors')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ vendor: vendor || null })
}
