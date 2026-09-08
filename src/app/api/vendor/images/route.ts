// ============================================================
// FILE: src/app/api/vendor/images/route.ts
// NEW FILE
// FEATURE: 5 (Image delete option in vendor portal)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function resolveVendor(admin: any, userId: string) {
  const { data: owner } = await admin.from('vendors').select('id').eq('user_id', userId).eq('status', 'approved').single()
  if (owner) return owner
  const { data: staff } = await admin.from('vendor_staff').select('vendor:vendors(id)').eq('user_id', userId).eq('active', true).single()
  return staff?.vendor || null
}

/**
 * GET ?productIds=a,b,c — every photo of those products, grouped by product.
 *
 * The product list only carries the FIRST photo per product now (Sakura's
 * list was 5 MB, almost all of it photo links nobody scrolled to). The rest
 * are fetched here when someone opens Edit, the product sheet, or "Change
 * Primary Images" — a page of rows at a time, never the whole catalogue.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = createAdminClient()
  const vendor = await resolveVendor(admin, user.id)
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const ids = String(req.nextUrl.searchParams.get('productIds') || '')
    .split(',').map(x => x.trim()).filter(x => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200)
  if (ids.length === 0) return NextResponse.json({ images: {} })

  const { data, error } = await admin.from('product_images')
    .select('id, url, sort_order, product_id, product:products!inner(vendor_id)')
    .in('product_id', ids).eq('product.vendor_id', vendor.id)
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const grouped: Record<string, any[]> = {}
  for (const id of ids) grouped[id] = []
  for (const row of (data || []) as any[]) {
    grouped[row.product_id].push({ id: row.id, url: row.url, sort_order: row.sort_order })
  }
  const res = NextResponse.json({ images: grouped })
  res.headers.set('Cache-Control', 'private, max-age=10')
  return res
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const admin = createAdminClient()
  // Owner, or an active staff member of the shop. This used to check only the
  // vendors table, so every staff login got 403 here — and because the client
  // discarded the response, a photo that never uploaded looked exactly like
  // one that had. The phone at the bench is a staff login.
  let vendor: any = null
  {
    const { data: owner } = await admin.from('vendors').select('id').eq('user_id', user.id).eq('status', 'approved').single()
    if (owner) vendor = owner
    else {
      const { data: staff } = await admin.from('vendor_staff').select('vendor:vendors(id)').eq('user_id', user.id).eq('active', true).single()
      if (staff?.vendor) vendor = staff.vendor
    }
  }
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
