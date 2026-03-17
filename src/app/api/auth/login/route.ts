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

  if (isAdmin) return NextResponse.json({ success: true, redirect: '/admin' })

  // Check if direct vendor owner
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id, status').eq('user_id', data.user.id).single()
  if (vendor && vendor.status === 'approved') return NextResponse.json({ success: true, redirect: '/vendor' })

  // Check if staff member
  const { data: staffLink } = await admin.from('vendor_staff').select('id').eq('user_id', data.user.id).eq('active', true).single()
  if (staffLink) return NextResponse.json({ success: true, redirect: '/vendor' })

  // Vendor pending approval
  if (vendor && vendor.status === 'pending') return NextResponse.json({ error: 'Your shop is pending approval.' }, { status: 403 })

  return NextResponse.json({ error: 'No vendor account found.' }, { status: 403 })
}
