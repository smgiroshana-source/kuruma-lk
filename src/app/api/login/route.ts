import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ role: 'none' })
  }

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase())
  if (adminEmails.includes(user.email?.toLowerCase() || '')) {
    return NextResponse.json({ role: 'admin' })
  }

  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id, status').eq('user_id', user.id).single()

  if (vendor) {
    return NextResponse.json({ role: 'vendor', status: vendor.status })
  }

  return NextResponse.json({ role: 'none' })
}
