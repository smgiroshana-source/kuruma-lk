import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabase } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/constants'

export async function POST(request: NextRequest) {
  // Verify admin
  const userSupabase = await createServerSupabase()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()
  const { action, vendorId, data: updateData } = body
  const admin = createAdminClient()

  switch (action) {
    case 'approve': {
      const { error } = await admin
        .from('vendors')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Vendor approved' })
    }

    case 'suspend': {
      const { error } = await admin
        .from('vendors')
        .update({ status: 'suspended', updated_at: new Date().toISOString() })
        .eq('id', vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Vendor suspended' })
    }

    case 'reactivate': {
      const { error } = await admin
        .from('vendors')
        .update({ status: 'approved', updated_at: new Date().toISOString() })
        .eq('id', vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Vendor reactivated' })
    }

    case 'reject':
    case 'delete': {
      // Delete all products and images first
      const { data: products } = await admin
        .from('products')
        .select('id')
        .eq('vendor_id', vendorId)

      if (products && products.length > 0) {
        const productIds = products.map(p => p.id)
        await admin.from('product_images').delete().in('product_id', productIds)
        await admin.from('products').delete().eq('vendor_id', vendorId)
      }

      // Delete sales
      const { data: sales } = await admin
        .from('sales')
        .select('id')
        .eq('vendor_id', vendorId)

      if (sales && sales.length > 0) {
        const saleIds = sales.map(s => s.id)
        await admin.from('sale_items').delete().in('sale_id', saleIds)
        await admin.from('sales').delete().eq('vendor_id', vendorId)
      }

      // Delete vendor
      const { error } = await admin.from('vendors').delete().eq('id', vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Vendor deleted' })
    }

    case 'update': {
      const { error } = await admin
        .from('vendors')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Vendor updated' })
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}
