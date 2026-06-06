import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
  return null
}

export async function GET() {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('suppliers')
    .select('id, name, contact_name, phone, email, country, currency, vat_registered, tin')
    .eq('vendor_id', vendor.id)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suppliers: data || [] })
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  const admin = createAdminClient()

  if (action === 'create') {
    const { name, contactName, phone, email, country, currency, vatRegistered, tin } = body
    if (!name?.trim()) return NextResponse.json({ error: 'Supplier name required' }, { status: 400 })

    const { data, error } = await admin.from('suppliers').insert({
      vendor_id: vendor.id,
      name: name.trim(),
      contact_name: contactName || null,
      phone: phone || null,
      email: email || null,
      country: country || 'LK',
      currency: currency || 'LKR',
      vat_registered: vatRegistered || false,
      tin: tin || null,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ supplier: data })
  }

  if (action === 'update') {
    const { id, name, contactName, phone, email, country, currency, vatRegistered, tin } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: 'Supplier name required' }, { status: 400 })

    const { data, error } = await admin.from('suppliers').update({
      name: name.trim(),
      contact_name: contactName || null,
      phone: phone || null,
      email: email || null,
      country: country || 'LK',
      currency: currency || 'LKR',
      vat_registered: vatRegistered || false,
      tin: tin || null,
    }).eq('id', id).eq('vendor_id', vendor.id).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ supplier: data })
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { error } = await admin.from('suppliers').delete().eq('id', id).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
