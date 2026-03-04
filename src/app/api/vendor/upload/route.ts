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

  const formData = await req.formData()
  const file = formData.get('image') as File
  const productId = formData.get('productId') as string

  if (!file || !productId) return NextResponse.json({ error: 'Missing image or productId' }, { status: 400 })

  const { data: product } = await admin.from('products').select('vendor_id').eq('id', productId).single()
  if (!product || product.vendor_id !== vendor.id) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const ext = file.name.split('.').pop() || 'jpg'
  const fileName = vendor.id + '/' + productId + '/' + Date.now() + '.' + ext
  const arrayBuffer = await file.arrayBuffer()
  const buffer = new Uint8Array(arrayBuffer)

  const { error: uploadError } = await admin.storage.from('product-images').upload(fileName, buffer, { contentType: file.type || 'image/jpeg', upsert: false })
  if (uploadError) return NextResponse.json({ error: 'Upload failed: ' + uploadError.message }, { status: 500 })

  const { data: urlData } = admin.storage.from('product-images').getPublicUrl(fileName)

  const { data: imageRecord, error: dbError } = await admin.from('product_images').insert({
    product_id: productId,
    url: urlData.publicUrl,
    sort_order: 0,
  }).select().single()

  if (dbError) return NextResponse.json({ error: 'DB save failed: ' + dbError.message }, { status: 500 })
  return NextResponse.json({ success: true, image: imageRecord, url: urlData.publicUrl, message: 'Image uploaded' })
}
