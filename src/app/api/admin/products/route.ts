// ============================================================
// FILE: src/app/api/admin/products/route.ts
// REPLACES: the entire existing file
// FEATURE: 3 (bulk_delete for super admin)
// ============================================================

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
      // Delete images from storage
      const { data: images } = await admin.from('product_images').select('url').eq('product_id', productId)
      if (images && images.length > 0) {
        const paths = images.map((img: any) => { const m = img.url.match(/product-images\/(.+)$/); return m ? m[1] : null }).filter(Boolean)
        if (paths.length > 0) await admin.storage.from('product-images').remove(paths)
      }
      await admin.from('product_images').delete().eq('product_id', productId)
      const { error } = await admin.from('products').delete().eq('id', productId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true, message: 'Product deleted' })
    }

    // ─── [NEW] BULK DELETE MULTIPLE PRODUCTS ───
    case 'bulk_delete': {
      const { productIds } = body
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0)
        return NextResponse.json({ error: 'No products selected' }, { status: 400 })

      // Delete images from storage
      const { data: images } = await admin
        .from('product_images')
        .select('url')
        .in('product_id', productIds)

      if (images && images.length > 0) {
        const paths = images
          .map((img: any) => { const m = img.url.match(/product-images\/(.+)$/); return m ? m[1] : null })
          .filter(Boolean)
        if (paths.length > 0) await admin.storage.from('product-images').remove(paths)
      }

      await admin.from('product_images').delete().in('product_id', productIds)
      const { error } = await admin.from('products').delete().in('id', productIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({
        success: true,
        deletedCount: productIds.length,
        message: `${productIds.length} product${productIds.length > 1 ? 's' : ''} deleted`
      })
    }

    default:
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
}
