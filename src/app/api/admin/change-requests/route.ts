// ============================================================
// FILE: src/app/api/admin/change-requests/route.ts
// NEW FILE
// FEATURE: 8 (Admin approves/rejects vendor detail changes)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/constants'

// GET: List all pending change requests
export async function GET() {
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || ''))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const admin = createAdminClient()

  const { data: requests } = await admin
    .from('vendor_change_requests')
    .select('*, vendor:vendors(id, name, phone, location, whatsapp)')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })

  return NextResponse.json({ success: true, requests: requests || [] })
}

// POST: Approve or reject a change request
export async function POST(request: NextRequest) {
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || ''))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const body = await request.json()
  const { action, requestId, reason } = body
  const admin = createAdminClient()

  // Get the change request
  const { data: changeRequest } = await admin
    .from('vendor_change_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single()

  if (!changeRequest)
    return NextResponse.json({ error: 'Request not found or already processed' }, { status: 404 })

  if (action === 'approve') {
    // Apply the changes to the vendor
    const { error: updateError } = await admin
      .from('vendors')
      .update({
        ...changeRequest.requested_changes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', changeRequest.vendor_id)

    if (updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })

    // Mark request as approved
    await admin
      .from('vendor_change_requests')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', requestId)

    return NextResponse.json({ success: true, message: 'Changes approved and applied' })
  }

  if (action === 'reject') {
    await admin
      .from('vendor_change_requests')
      .update({
        status: 'rejected',
        reason: reason || 'No reason provided',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
      })
      .eq('id', requestId)

    return NextResponse.json({ success: true, message: 'Changes rejected' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
