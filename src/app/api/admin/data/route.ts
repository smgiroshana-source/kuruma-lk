import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/constants'

export async function GET() {
  // Verify admin
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const admin = createAdminClient()

  // Fetch ALL vendors (including pending, suspended)
  const { data: vendors } = await admin
    .from('vendors')
    .select('*')
    .order('created_at', { ascending: false }).limit(500)

  // Get accurate product counts using count queries
  const { count: totalProducts } = await admin
    .from('products')
    .select('*', { count: 'exact', head: true })

  const { count: activeProducts } = await admin
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)

  // Fetch all products (Supabase default limit is 1000, need to paginate for large datasets)
  let products: any[] = []
  let from = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data } = await admin
      .from('products')
      .select('*, vendor:vendors(id, name, location, slug)')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    products = products.concat(data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  // Fetch recent sales (last 1000)
  const { data: sales } = await admin
    .from('sales')
    .select('*, items:sale_items(*)')
    .order('created_at', { ascending: false }).limit(1000)

  // Calculate stats
  const approvedVendors = (vendors || []).filter(v => v.status === 'approved').length
  const pendingVendors = (vendors || []).filter(v => v.status === 'pending').length
  const totalStockValue = (products || []).reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0)
  const totalSales = (sales || []).reduce((sum, s) => sum + (s.total || 0), 0)

  return NextResponse.json({
    stats: {
      approvedVendors,
      pendingVendors,
      totalProducts: totalProducts || 0,
      activeProducts: activeProducts || 0,
      totalStockValue,
      totalSales,
      totalSalesCount: (sales || []).length,
    },
    vendors: vendors || [],
    products: products || [],
    sales: sales || [],
  })
}
