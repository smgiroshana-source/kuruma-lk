import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/fetchAll'

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

// ─── GET ──────────────────────────────────────────────────────────────────────
// GET — list all active suppliers for this vendor, enriched with payable totals
export async function GET() {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = auth
  const admin = createAdminClient()

  // Fetch all active suppliers for this vendor
  const { data: suppliers, error: suppliersError } = await admin
    .from('suppliers')
    .select('*')
    .eq('vendor_id', vendor.id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (suppliersError) return NextResponse.json({ error: suppliersError.message }, { status: 500 })

  // Fetch all unpaid/partial/overdue invoices (paginated — a vendor with >1000
  // open invoices would otherwise have payables/overdue totals understated)
  let invoices: any[]
  try {
    invoices = await fetchAllRows((from, to) => admin
      .from('supplier_invoices')
      .select('supplier_id, amount, amount_paid, status, due_date')
      .eq('vendor_id', vendor.id)
      .neq('status', 'paid')
      .order('id')
      .range(from, to))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load invoices' }, { status: 500 })
  }

  // Aggregate per supplier in JS
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  type InvoiceAgg = {
    total_owed: number
    overdue_count: number
    overdue_amount: number
    oldest_overdue_days: number
  }
  const agg: Record<string, InvoiceAgg> = {}

  for (const inv of (invoices || [])) {
    const sid = inv.supplier_id as string
    if (!agg[sid]) {
      agg[sid] = { total_owed: 0, overdue_count: 0, overdue_amount: 0, oldest_overdue_days: 0 }
    }
    const owed = (inv.amount as number) - (inv.amount_paid as number)
    agg[sid].total_owed += owed

    if (inv.status === 'overdue') {
      agg[sid].overdue_count += 1
      agg[sid].overdue_amount += owed
      const dueDate = new Date(inv.due_date as string)
      dueDate.setHours(0, 0, 0, 0)
      const diffDays = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays > agg[sid].oldest_overdue_days) {
        agg[sid].oldest_overdue_days = diffDays
      }
    }
  }

  // Merge aggregates into supplier rows
  const enriched = (suppliers || []).map((s) => {
    const totals = agg[s.id as string] ?? {
      total_owed: 0,
      overdue_count: 0,
      overdue_amount: 0,
      oldest_overdue_days: 0,
    }
    return { ...s, ...totals }
  })

  return NextResponse.json({ suppliers: enriched })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
// POST { action: 'create', ...fields } — create a new supplier
// POST { action: 'update', supplierId, ...fields } — update an existing supplier
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = auth
  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── CREATE SUPPLIER ──────────────────────────────────────────────────────────
  if (action === 'create') {
    const { name, contact_name, phone, email, address, payment_terms, notes } = body as {
      name: string
      contact_name?: string
      phone?: string
      email?: string
      address?: string
      payment_terms?: number
      notes?: string
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const { data: supplier, error } = await admin
      .from('suppliers')
      .insert({
        vendor_id: vendor.id,
        name: name.trim(),
        contact_name: contact_name ?? null,
        phone: phone ?? null,
        email: email ?? null,
        address: address ?? null,
        payment_terms: payment_terms ?? 30,
        notes: notes ?? null,
        is_active: true,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, supplier })
  }

  // ── UPDATE SUPPLIER ──────────────────────────────────────────────────────────
  if (action === 'update') {
    const { supplierId, name, contact_name, phone, email, address, payment_terms, notes, is_active } = body as {
      supplierId: string
      name?: string
      contact_name?: string
      phone?: string
      email?: string
      address?: string
      payment_terms?: number
      notes?: string
      is_active?: boolean
    }

    if (!supplierId) {
      return NextResponse.json({ error: 'supplierId is required' }, { status: 400 })
    }

    // Verify supplier belongs to this vendor
    const { data: existing, error: fetchError } = await admin
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .eq('vendor_id', vendor.id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    // Build update object — only include fields that were provided
    const updates: Record<string, unknown> = {}
    if (name !== undefined)          updates.name          = name.trim()
    if (contact_name !== undefined)  updates.contact_name  = contact_name
    if (phone !== undefined)         updates.phone         = phone
    if (email !== undefined)         updates.email         = email
    if (address !== undefined)       updates.address       = address
    if (payment_terms !== undefined) updates.payment_terms = payment_terms
    if (notes !== undefined)         updates.notes         = notes
    if (is_active !== undefined)     updates.is_active     = is_active

    const { error } = await admin
      .from('suppliers')
      .update(updates)
      .eq('id', supplierId)
      .eq('vendor_id', vendor.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
