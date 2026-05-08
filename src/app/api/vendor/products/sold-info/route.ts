import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  const { data: staffLink } = await admin.from('vendor_staff').select('vendor:vendors(id)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
  return null
}

export async function GET() {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Get all sale_items with their sale info, ordered newest first.
  // We then keep only the LAST sale per product_id client-side.
  const vendorId = (vendor as any).id
  const { data: items, error } = await admin
    .from('sale_items')
    .select('product_id, unit_price, sales!inner(id, created_at, customer_name, payment_status, vendor_id)')
    .eq('sales.vendor_id', vendorId)
    .not('sales.payment_status', 'in', '("voided","draft")')
    .order('sales.created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Build map: product_id → most recent sale info (first occurrence = most recent due to ordering)
  const map: Record<string, { sold_price: number; sold_date: string; customer_name: string }> = {}
  for (const item of (items || [])) {
    if (!item.product_id || map[item.product_id]) continue
    const sale: any = Array.isArray(item.sales) ? item.sales[0] : item.sales
    map[item.product_id] = {
      sold_price: item.unit_price,
      sold_date: sale?.created_at || '',
      customer_name: sale?.customer_name || 'Walk-in',
    }
  }

  return NextResponse.json({ soldInfo: map })
}
