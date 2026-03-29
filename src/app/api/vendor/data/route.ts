import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = createAdminClient()
  let { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (!vendor) {
    const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
    if (staffLink?.vendor) vendor = staffLink.vendor
  }
  if (!vendor) return NextResponse.json({ error: 'No vendor found' }, { status: 403 })

  // Fetch products in pages (Supabase default limit is 1000)
  // Only select essential fields + primary image, not all images
  let products: any[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data } = await admin
      .from('products')
      .select('id, sku, name, description, category, make, model, model_code, year, condition, side, color, oem_code, cost, price, quantity, show_price, is_active, vendor_id, created_at, images:product_images(id, url, sort_order)')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    products = products.concat(data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Get stats using counts (faster than loading all sales)
  const { count: totalSalesCount } = await admin
    .from('sales')
    .select('*', { count: 'exact', head: true })
    .eq('vendor_id', vendor.id)

  // Only fetch recent sales for overview (not all)
  const { data: recentSales } = await admin
    .from('sales')
    .select('total')
    .eq('vendor_id', vendor.id)

  const totalProducts = products.length
  const activeProducts = products.filter((p: any) => p.is_active).length
  const totalStock = products.reduce((sum: number, p: any) => sum + (p.quantity || 0), 0)
  const stockValue = products.reduce((sum: number, p: any) => sum + ((p.price || 0) * (p.quantity || 0)), 0)
  const totalSales = (recentSales || []).reduce((sum: number, s: any) => sum + (s.total || 0), 0)

  return NextResponse.json({
    vendor,
    products,
    stats: { totalProducts, activeProducts, totalStock, stockValue, totalSales, totalSalesCount: totalSalesCount || 0 }
  })
}
