import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// VAT period locks — owner only.
//
// The owner locks a month when its figures are FINALISED for filing (owner,
// 2026-11-13) — the dashboard's "Filed ✓" tick confirms the filing itself.
// From the lock on, nothing may change that month's VAT: every path that
// could (tax invoices, voids, promotions, credit moves, GRNs, expenses,
// Cusdecs, supplier notes, a full-return credit note's void) checks
// frozenPeriodMessage() in src/lib/taxRates.ts and refuses. Documents dated
// now are still refused while the CURRENT month is locked (lockedNowMessage).
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
    return NextResponse.json({ ok: true, message: `${period} finalised — its VAT figures are frozen; file exactly these` })
  }

  if (action === 'unlock') {
    const { error } = await admin.from('vat_period_locks').delete()
      .eq('vendor_id', caller.vendor.id).eq('period', period)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, message: `${period} open again — finalise it once corrected` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
