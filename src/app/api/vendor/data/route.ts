import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
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

  // Check if this is a "quick" load (just vendor + stats, no products)
  const quick = req.nextUrl.searchParams.get('quick')

  if (quick === '1') {
    // Fast path: only vendor info + stats counts (no products loaded)
    const [
      { count: totalProducts },
      { count: activeProducts },
      { count: totalSalesCount }
    ] = await Promise.all([
      admin.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
      admin.from('products').select('*', { count: 'exact', head: true }).eq('vendor_id', vendor.id).eq('is_active', true),
      admin.from('sales').select('*', { count: 'exact', head: true }).eq('vendor_id', vendor.id),
    ])

    // Get stock count and stock value with a simple query
    const { data: stockData } = await admin
      .from('products')
      .select('quantity, price')
      .eq('vendor_id', vendor.id)
      .gt('quantity', 0)

    const totalStock = (stockData || []).reduce((s: number, p: any) => s + (p.quantity || 0), 0)
    const stockValue = (stockData || []).reduce((s: number, p: any) => s + ((p.price || 0) * (p.quantity || 0)), 0)

    // Get total sales amount
    const { data: salesTotals } = await admin
      .from('sales')
      .select('total')
      .eq('vendor_id', vendor.id)
      .neq('payment_status', 'voided')

    const totalSales = (salesTotals || []).reduce((s: number, x: any) => s + parseFloat(x.total || 0), 0)

    const response = NextResponse.json({
      vendor,
      products: [], // Empty — products loaded separately
      stats: { totalProducts: totalProducts || 0, activeProducts: activeProducts || 0, totalStock, stockValue, totalSales, totalSalesCount: totalSalesCount || 0 }
    })
    response.headers.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30')
    return response
  }

  // Full load: vendor + all products (for Products tab)
  const PAGE_SIZE = 1000
  let products: any[] = []
  let from = 0
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

  // Trim images: only keep up to 6 per product
  products = products.map((p: any) => ({
    ...p,
    images: (p.images || [])
      .sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      .slice(0, 6)
  }))

  const totalProducts = products.length
  const activeProducts = products.filter((p: any) => p.is_active).length
  const totalStock = products.reduce((sum: number, p: any) => sum + (p.quantity || 0), 0)
  const stockValue = products.reduce((sum: number, p: any) => sum + ((p.price || 0) * (p.quantity || 0)), 0)

  const { data: salesTotals } = await admin.from('sales').select('total').eq('vendor_id', vendor.id).neq('payment_status', 'voided')
  const totalSales = (salesTotals || []).reduce((s: number, x: any) => s + parseFloat(x.total || 0), 0)
  const totalSalesCount = (salesTotals || []).length

  const response = NextResponse.json({
    vendor,
    products,
    stats: { totalProducts, activeProducts, totalStock, stockValue, totalSales, totalSalesCount }
  })
  response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
  return response
}
