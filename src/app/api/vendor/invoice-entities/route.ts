import { NextResponse } from 'next/server'
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

export async function GET() {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  // REPR/WPRO are the WORKSHOP's entities (billed from Workshop Pulse at its
  // own location) — hidden from the tyre-shop POS picker on purpose. Tax
  // reports query invoice_entities directly, so they still consolidate REPR.
  const { data: entities, error } = await admin
    .from('invoice_entities')
    .select('id, name, address, tin, vat_registered, invoice_mode, serial_qqqq, receipt_prefix, is_default')
    .eq('vendor_id', vendor.id)
    .not('serial_qqqq', 'in', '(REPR,WPRO)')
    .order('is_default', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ entities: entities || [] })
}
