import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ user: null, vendor: null })

  const admin = createAdminClient()
  const { data: vendor } = await admin
    .from('vendors')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({
    user: { id: user.id, email: user.email },
    vendor: vendor || null,
  })
}
