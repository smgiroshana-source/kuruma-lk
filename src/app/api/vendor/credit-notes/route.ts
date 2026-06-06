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

// ── POST — Issue a credit note ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { saleId, returnedItems, reason } = await req.json()
  // returnedItems: [{ saleItemId: string, quantity: number }]

  if (!saleId || !Array.isArray(returnedItems) || returnedItems.length === 0)
    return NextResponse.json({ error: 'saleId and returnedItems required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch original sale + items
  const { data: sale } = await admin
    .from('sales')
    .select('*, items:sale_items(*)')
    .eq('id', saleId)
    .eq('vendor_id', vendor.id)
    .single()

  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (!sale.tax_serial) return NextResponse.json({ error: 'Credit notes only apply to tax invoices (gazette serial required)' }, { status: 400 })
  if (!sale.invoice_entity_id) return NextResponse.json({ error: 'Sale has no invoice entity' }, { status: 400 })

  // Get VAT rate from tax_config
  const { data: vatRow } = await admin.from('tax_config').select('value').eq('vendor_id', vendor.id).eq('key', 'vat_rate').single()
  const vatRate = vatRow ? parseFloat(vatRow.value) : 18

  // Build credit note items — cap at available quantity
  let totalAmount = 0
  const cnItems: any[] = []

  for (const ri of returnedItems) {
    const item = (sale.items || []).find((i: any) => i.id === ri.saleItemId)
    if (!item) continue
    const maxQty = item.quantity - (item.returned_quantity || 0)
    const qty = Math.min(Math.max(0, ri.quantity), maxQty)
    if (qty <= 0) continue
    const unitPrice = Math.round(parseFloat(item.unit_price || 0))
    const lineTotal = qty * unitPrice
    totalAmount += lineTotal
    cnItems.push({
      original_item_id: item.id,
      product_name: item.product_name,
      quantity: qty,
      unit_price: unitPrice,
      total: lineTotal,
      sscl_stream: item.sscl_stream || 'PART',
    })
  }

  if (totalAmount === 0 || cnItems.length === 0)
    return NextResponse.json({ error: 'No returnable items selected' }, { status: 400 })

  const vatAmount = Math.round(totalAmount * vatRate / (100 + vatRate))
  const netAmount = totalAmount - vatAmount

  // Reserve next credit note number (reuse invoice_sequences with period = 'credit')
  const { data: seqNum, error: seqError } = await admin.rpc('next_invoice_serial', {
    p_entity_id: sale.invoice_entity_id,
    p_period: 'credit',
  })
  if (seqError || seqNum == null)
    return NextResponse.json({ error: 'Failed to generate credit note number: ' + seqError?.message }, { status: 500 })

  const creditNoteNo = `CRN-${String(seqNum).padStart(5, '0')}`

  // Create the credit note header
  const { data: cn, error: cnError } = await admin
    .from('credit_notes')
    .insert({
      vendor_id: vendor.id,
      invoice_entity_id: sale.invoice_entity_id,
      original_sale_id: sale.id,
      original_serial: sale.tax_serial,
      credit_note_no: creditNoteNo,
      reason: reason || 'goods_returned',
      customer_name: sale.customer_name || null,
      customer_address: sale.customer_address || null,
      customer_tin: sale.customer_tin || null,
      net_amount: netAmount,
      vat_amount: vatAmount,
      total: totalAmount,
    })
    .select()
    .single()

  if (cnError) return NextResponse.json({ error: cnError.message }, { status: 500 })

  // Create credit note line items
  const { error: itemsError } = await admin
    .from('credit_note_items')
    .insert(cnItems.map(i => ({ ...i, credit_note_id: cn.id })))

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  return NextResponse.json({
    creditNote: { ...cn, items: cnItems },
    creditNoteNo,
  })
}

// ── GET — List credit notes (for VAT register / reports) ─────────────────────
export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  const admin = createAdminClient()

  let query = admin
    .from('credit_notes')
    .select('*, items:credit_note_items(*)')
    .eq('vendor_id', vendor.id)
    .order('issued_at', { ascending: true })

  if (from) query = query.gte('issued_at', `${from}T00:00:00.000Z`)
  if (to)   query = query.lte('issued_at', `${to}T23:59:59.999Z`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ creditNotes: data || [] })
}
