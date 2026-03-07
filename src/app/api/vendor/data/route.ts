import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).single()
  if (!vendor) return NextResponse.json({ error: 'No vendor found' }, { status: 403 })

  const { data: products } = await admin.from('products').select('*, images:product_images(*)').eq('vendor_id', vendor.id).order('created_at', { ascending: false }).limit(10000)
  const { data: sales } = await admin.from('sales').select('*').eq('vendor_id', vendor.id).order('created_at', { ascending: false }).limit(10000)

  const totalProducts = products?.length || 0
  const activeProducts = products?.filter((p: any) => p.is_active).length || 0
  const totalStock = products?.reduce((sum: number, p: any) => sum + (p.quantity || 0), 0) || 0
  const stockValue = products?.reduce((sum: number, p: any) => sum + ((p.price || 0) * (p.quantity || 0)), 0) || 0
  const totalSales = sales?.reduce((sum: number, s: any) => sum + (s.total || 0), 0) || 0

  return NextResponse.json({ vendor, products: products || [], sales: sales || [], stats: { totalProducts, activeProducts, totalStock, stockValue, totalSales, totalSalesCount: sales?.length || 0 } })
}
