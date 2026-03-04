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
    .order('created_at', { ascending: false })

  // Fetch ALL products with vendor info
  const { data: products } = await admin
    .from('products')
    .select('*, vendor:vendors(id, name, location, slug)')
    .order('created_at', { ascending: false })

  // Fetch ALL sales
  const { data: sales } = await admin
    .from('sales')
    .select('*, items:sale_items(*)')
    .order('created_at', { ascending: false })

  // Calculate stats
  const approvedVendors = (vendors || []).filter(v => v.status === 'approved').length
  const pendingVendors = (vendors || []).filter(v => v.status === 'pending').length
  const totalProducts = (products || []).length
  const activeProducts = (products || []).filter(p => p.is_active).length
  const totalStockValue = (products || []).reduce((sum, p) => sum + ((p.price || 0) * (p.quantity || 0)), 0)
  const totalSales = (sales || []).reduce((sum, s) => sum + (s.total || 0), 0)

  return NextResponse.json({
    stats: {
      approvedVendors,
      pendingVendors,
      totalProducts,
      activeProducts,
      totalStockValue,
      totalSales,
      totalSalesCount: (sales || []).length,
    },
    vendors: vendors || [],
    products: products || [],
    sales: sales || [],
  })
}
