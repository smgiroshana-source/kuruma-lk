import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
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
