import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id }
  return null
}

export async function GET() {
  const result = await getVendor()
  if (!result) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = result

  const admin = createAdminClient()
  const { data: accounts, error } = await admin
    .from('fleet_accounts')
    .select('*')
    .eq('vendor_id', vendor.id)
    .eq('is_active', true)
    .order('company_name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ accounts: accounts || [] })
}

export async function POST(req: NextRequest) {
  const result = await getVendor()
  if (!result) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = result

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const {
      company_name, contact_name, phone, email,
      address, tin, credit_limit, payment_terms, notes,
    } = body

    if (!company_name?.trim()) {
      return NextResponse.json({ error: 'company_name is required' }, { status: 400 })
    }

    const { data: account, error } = await admin
      .from('fleet_accounts')
      .insert({
        vendor_id: vendor.id,
        company_name: company_name.trim(),
        contact_name: contact_name?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
        tin: tin?.trim() || null,
        credit_limit: Number.isInteger(credit_limit) ? credit_limit : 0,
        payment_terms: Number.isInteger(payment_terms) ? payment_terms : 30,
        notes: notes?.trim() || null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, account })
  }

  if (action === 'update') {
    const {
      accountId, company_name, contact_name, phone, email,
      address, tin, credit_limit, payment_terms, notes, is_active,
    } = body

    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 })

    // Verify the account belongs to this vendor
    const { data: existing } = await admin
      .from('fleet_accounts')
      .select('id')
      .eq('id', accountId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!existing) return NextResponse.json({ error: 'Fleet account not found' }, { status: 404 })

    // Build update object with only provided fields
    const patch: Record<string, unknown> = {}
    if (company_name !== undefined) patch.company_name = company_name?.trim() || null
    if (contact_name !== undefined) patch.contact_name = contact_name?.trim() || null
    if (phone !== undefined) patch.phone = phone?.trim() || null
    if (email !== undefined) patch.email = email?.trim() || null
    if (address !== undefined) patch.address = address?.trim() || null
    if (tin !== undefined) patch.tin = tin?.trim() || null
    if (credit_limit !== undefined) patch.credit_limit = Number.isInteger(credit_limit) ? credit_limit : 0
    if (payment_terms !== undefined) patch.payment_terms = Number.isInteger(payment_terms) ? payment_terms : 30
    if (notes !== undefined) patch.notes = notes?.trim() || null
    if (is_active !== undefined) patch.is_active = Boolean(is_active)

    const { error } = await admin
      .from('fleet_accounts')
      .update(patch)
      .eq('id', accountId)
      .eq('vendor_id', vendor.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
