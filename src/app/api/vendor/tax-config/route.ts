import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { ...vendor, __owner: true }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { ...staffLink.vendor, __owner: false }
  return null
}

const ALLOWED_KEYS = ['vat_rate', 'sscl_rate', 'liable_base_part', 'liable_base_svc', 'card_fee_pct']

export async function GET() {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('tax_config')
    .select('key, value')
    .eq('vendor_id', vendor.id)
    .in('key', ALLOWED_KEYS)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const config: Record<string, number> = {
    vat_rate: 18,
    sscl_rate: 2.5,
    liable_base_part: 50,
    liable_base_svc: 100,
    // What the bank takes on the card machine — editable, not a tax
    card_fee_pct: 3.5,
  }
  for (const row of (rows || [])) config[row.key] = parseFloat(row.value)

  return NextResponse.json({ config })
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // ── Schedule a dated rate change (owner-typed date, e.g. a gazette change) ──
  // Reports use the rate as of each month they cover; invoices switch on the
  // effective date without anyone touching config that morning.
  if (body.action === 'schedule_rate') {
    if (!(vendor as any).__owner) return NextResponse.json({ error: 'Scheduling rate changes is owner-only' }, { status: 403 })
    const RATE_KEYS = ['vat_rate', 'sscl_rate', 'liable_base_part', 'liable_base_svc']
    const { key, value, effectiveFrom } = body
    if (!RATE_KEYS.includes(key)) return NextResponse.json({ error: 'key must be one of ' + RATE_KEYS.join(', ') }, { status: 400 })
    const val = parseFloat(value)
    if (isNaN(val) || val < 0 || val > 100) return NextResponse.json({ error: 'Invalid rate value' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(effectiveFrom || ''))) return NextResponse.json({ error: 'effectiveFrom must be YYYY-MM-DD' }, { status: 400 })
    const admin = createAdminClient()
    const { error } = await admin.from('tax_rate_history').upsert({
      vendor_id: vendor.id, key, value: val, effective_from: effectiveFrom,
      created_by: (vendor as any).email || null,
    }, { onConflict: 'vendor_id,key,effective_from' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Keep flat config in sync when the change is already in force
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    if (effectiveFrom <= today) {
      await admin.from('tax_config').upsert({ vendor_id: vendor.id, key, value: String(val) }, { onConflict: 'vendor_id,key' })
    }
    return NextResponse.json({ ok: true, message: `${key} = ${val} from ${effectiveFrom}` })
  }

  if (body.action === 'rate_history') {
    const admin = createAdminClient()
    const { data } = await admin.from('tax_rate_history')
      .select('key, value, effective_from, created_by')
      .eq('vendor_id', vendor.id).order('effective_from', { ascending: false })
    return NextResponse.json({ history: data || [] })
  }

  const updates: { key: string; value: string }[] = []

  for (const key of ALLOWED_KEYS) {
    if (body[key] !== undefined) {
      const val = parseFloat(body[key])
      if (isNaN(val) || val < 0) return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
      updates.push({ key, value: String(val) })
    }
  }

  if (updates.length === 0) return NextResponse.json({ error: 'No valid keys provided' }, { status: 400 })

  const admin = createAdminClient()
  for (const u of updates) {
    const { error } = await admin
      .from('tax_config')
      .upsert({ vendor_id: vendor.id, key: u.key, value: u.value }, { onConflict: 'vendor_id,key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
