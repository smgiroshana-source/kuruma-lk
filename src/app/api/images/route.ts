// ============================================================
// FILE: src/app/api/vendor/images/route.ts
// NEW FILE
// FEATURE: 5 (Image delete option in vendor portal)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('id').eq('user_id', user.id).eq('status', 'approved').single()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const body = await req.json()
  const { action, imageId } = body

  if (action === 'delete') {
    if (!imageId) return NextResponse.json({ error: 'Missing imageId' }, { status: 400 })

    // Verify image belongs to vendor's product
    const { data: image } = await admin
      .from('product_images')
      .select('id, url, product_id')
      .eq('id', imageId)
      .single()

    if (!image) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

    // Verify product belongs to this vendor
    const { data: product } = await admin
      .from('products')
      .select('vendor_id')
      .eq('id', image.product_id)
      .single()

    if (!product || product.vendor_id !== vendor.id)
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

    // Delete from Supabase Storage
    const urlMatch = image.url.match(/product-images\/(.+)$/)
    if (urlMatch) {
      await admin.storage.from('product-images').remove([urlMatch[1]])
    }

    // Delete database record
    const { error } = await admin.from('product_images').delete().eq('id', imageId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, message: 'Image deleted' })
  }

  if (action === 'reorder') {
    const { imageOrder } = body
    if (!imageOrder || !Array.isArray(imageOrder))
      return NextResponse.json({ error: 'Missing image order' }, { status: 400 })

    for (let i = 0; i < imageOrder.length; i++) {
      await admin.from('product_images')
        .update({ sort_order: i })
        .eq('id', imageOrder[i])
    }
    return NextResponse.json({ success: true, message: 'Images reordered' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
