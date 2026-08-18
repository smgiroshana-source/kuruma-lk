import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'

// ─────────────────────────────────────────────────────────────────────────────
// Cash movements — money moved, not money earned.
//
// owner_in  : owner's own money into the till        (drawer ↑, profit —)
// bank_in   : drawn from the bank for the till       (drawer ↑, profit —)
// to_bank   : day's cash banked                      (drawer ↓, profit —)
// owner_out : owner takes drawings                   (drawer ↓, profit —)
//
// Every write recomputes that day's session, so the drawer count stays right
// whether the movement is entered before or after closing.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner', email: user.email || '' }
  const { data: s } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (s?.vendor) return { vendor: s.vendor, role: s.role || 'cashier', email: user.email || '' }
  return null
}

const TYPES = ['owner_in', 'bank_in', 'to_bank', 'owner_out'] as const

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const url = new URL(req.url)
  const date = url.searchParams.get('date')
  const month = url.searchParams.get('month')

  let q = admin.from('cash_movements').select('*').eq('vendor_id', caller.vendor.id)
    .order('movement_date', { ascending: false }).order('created_at', { ascending: false })
  if (date) q = q.eq('movement_date', date)
  else if (month) q = q.gte('movement_date', `${month}-01`).lte('movement_date', `${month}-31`)
  else q = q.limit(100)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ movements: data || [] })
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))

  if (body.action === 'create') {
    const { movement_date, type, amount, note } = body
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(movement_date || ''))) {
      return NextResponse.json({ error: 'movement_date must be YYYY-MM-DD' }, { status: 400 })
    }
    if (!TYPES.includes(type)) return NextResponse.json({ error: 'Invalid movement type' }, { status: 400 })
    const amt = Math.round(Number(amount) || 0)
    if (amt <= 0) return NextResponse.json({ error: 'Amount must be a positive whole number' }, { status: 400 })
    // Owner drawings are the owner's business, literally
    if (type === 'owner_out' && caller.role !== 'owner') {
      return NextResponse.json({ error: 'Only the owner can record drawings' }, { status: 403 })
    }

    const { data, error } = await admin.from('cash_movements').insert({
      vendor_id: caller.vendor.id, movement_date, type, amount: amt,
      note: note?.trim() || null, created_by: caller.email,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await recomputeSessionForDate(admin, caller.vendor.id, movement_date)
    return NextResponse.json({ ok: true, movement: data })
  }

  if (body.action === 'delete') {
    // Removing a movement changes the drawer arithmetic — owner/manager only
    if (caller.role !== 'owner' && caller.role !== 'manager') {
      return NextResponse.json({ error: 'Owner or manager only' }, { status: 403 })
    }
    const { id } = body
    const { data: mov } = await admin.from('cash_movements')
      .select('id, movement_date').eq('id', id).eq('vendor_id', caller.vendor.id).single()
    if (!mov) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { error } = await admin.from('cash_movements').delete().eq('id', id).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await recomputeSessionForDate(admin, caller.vendor.id, mov.movement_date)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
