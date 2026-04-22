import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sharp from 'sharp'

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

  const arrayBuffer = await file.arrayBuffer()

  // Resize to max 1200px and convert to JPEG at quality 85 before storing.
  // This avoids Supabase Storage Image Transformation charges ($5/1000) while
  // keeping images web-ready. Phone photos (3-12 MB) shrink to ~200-400 KB.
  let buffer: Buffer
  try {
    buffer = await sharp(Buffer.from(arrayBuffer))
      .rotate() // auto-rotate based on EXIF orientation
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer()
  } catch {
    // Fallback: upload original if sharp fails (e.g. unsupported format)
    buffer = Buffer.from(arrayBuffer)
  }

  const fileName = vendor.id + '/' + productId + '/' + Date.now() + '.jpg'

  const { error: uploadError } = await admin.storage.from('product-images').upload(fileName, buffer, { contentType: 'image/jpeg', upsert: false })
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
