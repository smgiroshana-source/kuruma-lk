import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// VAT period locks — owner only.
//
// After the month's return is filed the owner locks it. A locked month takes
// no new tax documents: credit notes, bad-debt write-offs and recoveries are
// all refused while their (current) period is locked, and past periods can
// never be written into because every document this system creates is dated
// now. Locking is what keeps the filed return permanently equal to the
// register it was filed from.
// ─────────────────────────────────────────────────────────────────────────────

async function getOwner() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, email: user.email || '' }
  return null
}

export async function GET() {
  const caller = await getOwner()
  if (!caller) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const admin = createAdminClient()
  const { data, error } = await admin.from('vat_period_locks')
    .select('period, locked_by, locked_at')
    .eq('vendor_id', caller.vendor.id).order('period', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ locks: data || [] })
}

export async function POST(req: NextRequest) {
  const caller = await getOwner()
  if (!caller) return NextResponse.json({ error: 'Owner only' }, { status: 403 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { action, period } = body
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
  }

  if (action === 'lock') {
    const { error } = await admin.from('vat_period_locks').insert({
      vendor_id: caller.vendor.id, period, locked_by: caller.email,
    })
    if (error && !/duplicate/.test(error.message)) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, message: `${period} locked — no further tax documents can be dated into it` })
  }

  if (action === 'unlock') {
    const { error } = await admin.from('vat_period_locks').delete()
      .eq('vendor_id', caller.vendor.id).eq('period', period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, message: `${period} unlocked — remember to re-lock after corrections` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
