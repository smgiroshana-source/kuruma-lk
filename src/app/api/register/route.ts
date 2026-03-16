import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { email, password, businessName, phone, whatsapp, location, address, description } = body

  if (!email || !password || !businessName || !phone) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Create auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 })
  }

  if (!authData.user) {
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }

  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

  // Create vendor record
  const { error: vendorError } = await admin.from('vendors').insert({
    user_id: authData.user.id,
    name: businessName.trim(),
    slug,
    phone: phone.replace(/\D/g, '').replace(/^94/, '0').slice(0, 10),
    whatsapp: ((whatsapp || phone).replace(/\D/g, '').replace(/^94/, '0').slice(0, 10)),
    location: location || '',
    address: (address || '').trim(),
    description: (description || '').trim(),
    status: 'pending',
  })

  if (vendorError) {
    return NextResponse.json({ error: 'Account created but vendor registration failed: ' + vendorError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: 'Registration submitted' })
}
