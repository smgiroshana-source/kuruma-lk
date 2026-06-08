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

export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')   // 'vat_register' | 'sscl_report' | 'input_vat' | 'vat_summary'
  const from = searchParams.get('from')   // YYYY-MM-DD
  const to   = searchParams.get('to')     // YYYY-MM-DD

  if (!type || !from || !to) return NextResponse.json({ error: 'Missing params' }, { status: 400 })

  const admin = createAdminClient()

  // Get lk_tax entity IDs for this vendor (Pvt Ltd = invoice_mode 'lk_tax')
  const { data: lkTaxEntities } = await admin
    .from('invoice_entities')
    .select('id, name')
    .eq('vendor_id', vendor.id)
    .eq('invoice_mode', 'lk_tax')

  if (!lkTaxEntities || lkTaxEntities.length === 0) {
    return NextResponse.json({ error: 'No lk_tax entity found for this vendor' }, { status: 400 })
  }

  const entityIds = lkTaxEntities.map((e: any) => e.id)
  const fromTs = `${from}T00:00:00.000Z`
  const toTs   = `${to}T23:59:59.999Z`

  // ── VAT Output Register ─────────────────────────────────────────────────────
  if (type === 'vat_register') {
    // ── Tax invoices ──
    const { data: rows, error } = await admin
      .from('sales')
      .select('id, tax_serial, created_at, date_supply, customer_name, customer_tin, net_amount, vat_amount, total, payment_status, voided_at')
      .eq('vendor_id', vendor.id)
      .eq('document_type', 'tax_invoice')
      .in('invoice_entity_id', entityIds)
      .gte('created_at', fromTs)
      .lte('created_at', toTs)
      .order('tax_serial', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // ── Credit notes issued in the same period ──
    const { data: creditNotes } = await admin
      .from('credit_notes')
      .select('credit_note_no, issued_at, customer_name, customer_tin, net_amount, vat_amount, total, original_serial')
      .eq('vendor_id', vendor.id)
      .in('invoice_entity_id', entityIds)
      .gte('issued_at', fromTs)
      .lte('issued_at', toTs)
      .order('issued_at', { ascending: true })

    // Include voided invoices (marked VOID) — they stay in the ledger
    const invoiceRows = (rows || []).map((s: any) => ({
      rowType:      'invoice' as const,
      serial:       s.tax_serial,
      invoiceDate:  s.created_at,
      supplyDate:   s.date_supply,
      customerName: s.customer_name,
      customerTin:  s.customer_tin || null,
      netAmount:    parseInt(s.net_amount || 0),
      vatAmount:    parseInt(s.vat_amount || 0),
      total:        parseInt(s.total || 0),
      status:       s.voided_at ? 'VOID' : 'VALID',
    }))

    // Credit note rows — negative amounts, status = 'CRN'
    const cnRows = (creditNotes || []).map((cn: any) => ({
      rowType:      'credit_note' as const,
      serial:       cn.credit_note_no,
      invoiceDate:  cn.issued_at,
      supplyDate:   null,
      customerName: cn.customer_name,
      customerTin:  cn.customer_tin || null,
      netAmount:    -parseInt(cn.net_amount || 0),
      vatAmount:    -parseInt(cn.vat_amount || 0),
      total:        -parseInt(cn.total || 0),
      status:       'CRN',
      refSerial:    cn.original_serial,  // reference to original invoice
    }))

    // Merge and sort by date
    const register = [...invoiceRows, ...cnRows].sort((a, b) =>
      new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime()
    )

    // Totals — valid invoices minus credit notes
    const validInvoices = invoiceRows.filter(r => r.status === 'VALID')
    const totals = {
      netAmount:  validInvoices.reduce((s, r) => s + r.netAmount, 0) + cnRows.reduce((s, r) => s + r.netAmount, 0),
      vatAmount:  validInvoices.reduce((s, r) => s + r.vatAmount, 0) + cnRows.reduce((s, r) => s + r.vatAmount, 0),
      total:      validInvoices.reduce((s, r) => s + r.total, 0)     + cnRows.reduce((s, r) => s + r.total, 0),
      count:      validInvoices.length,
      voidCount:  invoiceRows.length - validInvoices.length,
      crnCount:   cnRows.length,
    }

    return NextResponse.json({ register, totals, entity: lkTaxEntities[0].name })
  }

  // ── SSCL Liability Report ───────────────────────────────────────────────────
  if (type === 'sscl_report') {
    // Fetch tax config rates
    const { data: configRows } = await admin
      .from('tax_config')
      .select('key, value')
      .eq('vendor_id', vendor.id)

    const config: Record<string, number> = {}
    for (const c of (configRows || [])) config[c.key] = parseFloat(c.value)

    const ssclRate       = (config['sscl_rate']        ?? 2.5)  / 100
    const liableBasePart = (config['liable_base_part'] ?? 50)   / 100
    const liableBaseSvc  = (config['liable_base_svc']  ?? 100)  / 100

    // Get non-voided sales in range for lk_tax entities
    const { data: sales } = await admin
      .from('sales')
      .select('id, created_at')
      .eq('vendor_id', vendor.id)
      .in('invoice_entity_id', entityIds)
      .neq('payment_status', 'voided')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)

    if (!sales || sales.length === 0) {
      return NextResponse.json({ months: [], totals: { partTurnover: 0, svcTurnover: 0, ssclDue: 0 }, config: { ssclRate, liableBasePart, liableBaseSvc } })
    }

    const saleIds = sales.map((s: any) => s.id)
    const saleDateMap: Record<string, string> = {}
    for (const s of sales) saleDateMap[s.id] = s.created_at

    // Get all sale items for these sales
    const { data: items, error: itemsError } = await admin
      .from('sale_items')
      .select('sale_id, sscl_stream, total')
      .in('sale_id', saleIds)

    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

    // Aggregate by month × stream
    const monthMap: Record<string, { PART: number; SVC: number }> = {}
    for (const item of (items || [])) {
      const monthKey = saleDateMap[item.sale_id]?.slice(0, 7) ?? 'unknown'
      if (!monthMap[monthKey]) monthMap[monthKey] = { PART: 0, SVC: 0 }
      const stream = (item.sscl_stream || 'PART') as 'PART' | 'SVC'
      monthMap[monthKey][stream] += parseFloat(item.total || 0)
    }

    // Build report rows
    const months = Object.keys(monthMap).sort().map(month => {
      const partTurnover = Math.round(monthMap[month].PART)
      const svcTurnover  = Math.round(monthMap[month].SVC)
      const partLiable   = Math.round(partTurnover * liableBasePart)
      const svcLiable    = Math.round(svcTurnover  * liableBaseSvc)
      const partSscl     = Math.round(partLiable    * ssclRate)
      const svcSscl      = Math.round(svcLiable     * ssclRate)
      return {
        month,
        partTurnover, svcTurnover,
        totalTurnover: partTurnover + svcTurnover,
        partLiable, svcLiable,
        totalLiable: partLiable + svcLiable,
        partSscl, svcSscl,
        totalSscl: partSscl + svcSscl,
      }
    })

    const totals = {
      partTurnover:  months.reduce((s, r) => s + r.partTurnover, 0),
      svcTurnover:   months.reduce((s, r) => s + r.svcTurnover, 0),
      totalTurnover: months.reduce((s, r) => s + r.totalTurnover, 0),
      partLiable:    months.reduce((s, r) => s + r.partLiable, 0),
      svcLiable:     months.reduce((s, r) => s + r.svcLiable, 0),
      totalLiable:   months.reduce((s, r) => s + r.totalLiable, 0),
      partSscl:      months.reduce((s, r) => s + r.partSscl, 0),
      svcSscl:       months.reduce((s, r) => s + r.svcSscl, 0),
      ssclDue:       months.reduce((s, r) => s + r.totalSscl, 0),
    }

    return NextResponse.json({
      months, totals,
      config: { ssclRate: ssclRate * 100, liableBasePart: liableBasePart * 100, liableBaseSvc: liableBaseSvc * 100 },
      entity: lkTaxEntities[0].name,
    })
  }

  // ── Input VAT Register ─────────────────────────────────────────────────────
  if (type === 'input_vat') {
    // Only GRNs from VAT-registered suppliers are claimable as input VAT (IRD requirement).
    // supplier_vat_registered is snapshotted at GRN creation time.
    // Older GRNs without the column are included (no filter) so historical data isn't lost —
    // they are flagged with a warning in the response.
    const { data: grns, error: grnsError } = await admin
      .from('grns')
      .select('id, grn_number, received_at, supplier_name, supplier_tin, supplier_vat_registered, supplier_invoice_no, net_cost, input_vat, total_cost')
      .eq('vendor_id', vendor.id)
      .eq('status', 'posted')
      .gt('input_vat', 0)
      .gte('received_at', from)
      .lte('received_at', to)
      .order('received_at', { ascending: true })
      .order('created_at', { ascending: true })

    if (grnsError) return NextResponse.json({ error: grnsError.message }, { status: 500 })

    const rows = (grns || []).map((g: any) => ({
      grnNumber:             g.grn_number,
      receivedAt:            g.received_at,
      supplierName:          g.supplier_name || '—',
      supplierTin:           g.supplier_tin  || null,
      supplierVatRegistered: g.supplier_vat_registered ?? null,  // null = legacy GRN (pre-fix)
      supplierInvoiceNo:     g.supplier_invoice_no || null,
      netCost:               parseInt(g.net_cost   || 0),
      inputVat:              parseInt(g.input_vat  || 0),
      totalCost:             parseInt(g.total_cost || 0),
      claimable:             g.supplier_vat_registered !== false,  // true for legacy + VAT-reg
    }))

    // Aggregate by month
    const monthMap: Record<string, { netCost: number; inputVat: number; totalCost: number; count: number }> = {}
    for (const r of rows) {
      const monthKey = r.receivedAt.slice(0, 7)
      if (!monthMap[monthKey]) monthMap[monthKey] = { netCost: 0, inputVat: 0, totalCost: 0, count: 0 }
      monthMap[monthKey].netCost   += r.netCost
      monthMap[monthKey].inputVat  += r.inputVat
      monthMap[monthKey].totalCost += r.totalCost
      monthMap[monthKey].count     += 1
    }

    const months = Object.keys(monthMap).sort().map(month => ({
      month,
      ...monthMap[month],
    }))

    const claimableRows    = rows.filter(r => r.claimable)
    const nonClaimableRows = rows.filter(r => !r.claimable)

    const totals = {
      netCost:            claimableRows.reduce((s, r) => s + r.netCost,   0),
      inputVat:           claimableRows.reduce((s, r) => s + r.inputVat,  0),
      totalCost:          claimableRows.reduce((s, r) => s + r.totalCost, 0),
      count:              claimableRows.length,
      nonClaimableCount:  nonClaimableRows.length,
      nonClaimableVat:    nonClaimableRows.reduce((s, r) => s + r.inputVat, 0),
    }

    return NextResponse.json({ rows, months, totals, entity: lkTaxEntities[0].name })
  }

  // ── VAT Summary (Output − Input = Net Payable) ─────────────────────────────
  if (type === 'vat_summary') {
    // ── Output VAT: valid invoices minus credit notes ──
    const [{ data: invoices }, { data: creditNotes }] = await Promise.all([
      admin
        .from('sales')
        .select('net_amount, vat_amount, total, voided_at')
        .eq('vendor_id', vendor.id)
        .eq('document_type', 'tax_invoice')
        .in('invoice_entity_id', entityIds)
        .gte('created_at', fromTs)
        .lte('created_at', toTs),
      admin
        .from('credit_notes')
        .select('net_amount, vat_amount, total')
        .eq('vendor_id', vendor.id)
        .in('invoice_entity_id', entityIds)
        .gte('issued_at', fromTs)
        .lte('issued_at', toTs),
    ])

    const validInvoices = (invoices || []).filter((s: any) => !s.voided_at)
    const outputVatNet  = validInvoices.reduce((s: number, r: any) => s + parseInt(r.vat_amount || 0), 0)
    const outputVatCrn  = (creditNotes || []).reduce((s: number, r: any) => s + parseInt(r.vat_amount || 0), 0)
    const outputVat     = outputVatNet - outputVatCrn

    const outputNetSales = validInvoices.reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
                         - (creditNotes || []).reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
    const outputTotal    = validInvoices.reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)
                         - (creditNotes || []).reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)

    // ── Input VAT: posted GRNs from VAT-registered suppliers only ──
    // supplier_vat_registered=false GRNs are excluded — those invoices are not
    // valid tax invoices and the IRD will disallow the claim.
    // supplier_vat_registered=null means legacy GRN (created before the column existed) —
    // included with a conservative assumption; accountant should verify those manually.
    const { data: grns } = await admin
      .from('grns')
      .select('input_vat, supplier_vat_registered')
      .eq('vendor_id', vendor.id)
      .eq('status', 'posted')
      .gt('input_vat', 0)
      .gte('received_at', from)
      .lte('received_at', to)

    const inputVat = (grns || [])
      .filter((g: any) => g.supplier_vat_registered !== false)   // exclude known non-VAT suppliers
      .reduce((s: number, g: any) => s + parseInt(g.input_vat || 0), 0)

    const netPayable = outputVat - inputVat

    return NextResponse.json({
      outputVat,
      outputNetSales,
      outputTotal,
      inputVat,
      netPayable,
      invoiceCount: validInvoices.length,
      crnCount:     (creditNotes || []).length,
      period:       { from, to },
      entity:       lkTaxEntities[0].name,
    })
  }

  return NextResponse.json({ error: 'Unknown report type' }, { status: 400 })
}
