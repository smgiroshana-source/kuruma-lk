import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import sharp from 'sharp'

export async function POST(req: NextRequest) {
  // Refuse on the declared length BEFORE the body is parsed. The check on
  // file.size below runs only after req.formData() has already pulled the
  // whole upload into memory — which for a 16 MB body surfaced as a 500 from
  // the framework, not a 413 from us. Content-Length is set by every browser
  // and by the phone; a client that omits it still meets the file.size check.
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: `That photo is about ${Math.round(declared / 1048576)} MB — the limit is ${MAX_UPLOAD_BYTES / 1048576} MB.` }, { status: 413 })
  }

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

  const formData = await req.formData()
  const file = formData.get('image') as File
  const productId = formData.get('productId') as string

  if (!file || !productId) return NextResponse.json({ error: 'Missing image or productId' }, { status: 400 })
  // Refuse before the body is read into memory: a 300 MB "photo" was buffered
  // whole before sharp ever saw it. Type is a hint only — sharp is the judge —
  // but a text file has no business here.
  if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `That photo is ${Math.round(file.size / 1048576)} MB — the limit is ${MAX_UPLOAD_BYTES / 1048576} MB.` }, { status: 413 })
  }
  if (file.type && !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Only image files can be uploaded.' }, { status: 415 })
  }

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
    // Used to fall back to storing the original bytes as a ".jpg". For a file
    // sharp cannot read that stored something no browser can render — a blank
    // grey tile that reported "Image uploaded". An upload that cannot become
    // a picture is a failed upload, and the client now says so.
    return NextResponse.json({ error: 'That file is not a readable image. Take the photo again, or choose a JPEG or PNG.' }, { status: 415 })
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
