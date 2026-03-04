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
  const { action, productId, data: updateData } = body
  const admin = createAdminClient()

  switch (action) {
    case 'toggle': {
      // Toggle active/inactive
      const { data: product } = await admin
        .from('products')
        .select('is_active')
        .eq('id', productId)
        .single()

      if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

      const { error } = await admin
        .from('products')
        .update({ is_active: !product.is_active, updated_at: new Date().toISOString() })
        .eq('id', productId)

      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: `Product ${product.is_active ? 'deactivated' : 'activated'}` })
    }

    case 'update': {
      const { error } = await admin
        .from('products')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', productId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Product updated' })
    }

    case 'delete': {
      // Delete images first
      await admin.from('product_images').delete().eq('product_id', productId)
      const { error } = await admin.from('products').delete().eq('id', productId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Product deleted' })
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}
