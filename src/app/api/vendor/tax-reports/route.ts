import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'
import { resolveBranch } from '@/lib/branchScope'

// Month bucket in the Colombo calendar — slicing the raw UTC timestamp bins
// late-night (pre-05:30) transactions into the previous month.
const colomboMonth = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7) : 'unknown'

// A full return VOIDS the original invoice (CLAUDE.md) AND issues a CRN. The
// void already removes the sale's output VAT / SSCL turnover from the reports,
// so counting the CRN as well would reverse the same tax twice. Returns the
// original_sale_ids whose sale is voided — those CRNs must not affect totals.
async function voidedOriginalIds(admin: any, creditNotes: any[]): Promise<Set<string>> {
  const ids = [...new Set((creditNotes || []).map((c: any) => c.original_sale_id).filter(Boolean))] as string[]
  if (!ids.length) return new Set()
  const sales = await fetchAllByIds(ids, (chunk, from, to) => admin
    .from('sales').select('id, voided_at, payment_status').in('id', chunk).order('id').range(from, to))
  return new Set((sales || []).filter((s: any) => s.voided_at || s.payment_status === 'voided').map((s: any) => s.id))
}

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { ...vendor, branchScope: 'both', canFileTax: true }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { ...staffLink.vendor, branchScope: staffLink.branch_scope || 'shop', canFileTax: staffLink.can_file_tax === true }
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
  const { data: lkTaxEntitiesRaw } = await admin
    .from('invoice_entities')
    .select('id, name, branch, serial_qqqq')
    .eq('vendor_id', vendor.id)
    .eq('invoice_mode', 'lk_tax')

  if (!lkTaxEntitiesRaw || lkTaxEntitiesRaw.length === 0) {
    return NextResponse.json({ error: 'No lk_tax entity found for this vendor' }, { status: 400 })
  }

  // ⚠️ FILING RULE: the Pvt Ltd is ONE taxpayer (TIN 101969738) and files ONE
  // consolidated VAT/SSCL return covering every stream — PART (shop) and REPR
  // (workshop) together. So the branch filter is deliberately NOT honoured for
  // owners: tax reports are always whole-company. A branch-scoped staff login
  // still only sees its own side (privacy), and that partial view is flagged
  // `filing_valid: false` so the UI can warn it must never go to IRD.
  // Someone trusted with tax filing (the owner, or a staff login the owner has
  // granted it to) always gets the consolidated whole-company figures.
  const scope = (vendor as any).canFileTax ? 'both' : (vendor as any).branchScope
  const branch = resolveBranch(scope, null)
  const isWorkshop = (e: any) => (e.branch ? e.branch === 'workshop' : ['REPR', 'WPRO'].includes(e.serial_qqqq))
  const lkTaxEntities = branch
    ? lkTaxEntitiesRaw.filter((e: any) => (branch === 'workshop' ? isWorkshop(e) : !isWorkshop(e)))
    : lkTaxEntitiesRaw
  const entityIds = lkTaxEntities.map((e: any) => e.id)
  if (entityIds.length === 0) {
    return NextResponse.json({ error: `No ${branch} tax entity configured` }, { status: 400 })
  }
  // Period boundaries are Colombo calendar days, NOT UTC. A CRN issued at
  // 00:29 Colombo on the 14th is 18:59 UTC on the 13th — UTC boundaries let it
  // leak into a register ending on the 13th while its original invoice
  // (correctly) stays out, producing phantom negative totals.
  const fromTs = new Date(`${from}T00:00:00.000+05:30`).toISOString()
  const toTs   = new Date(`${to}T23:59:59.999+05:30`).toISOString()

  // ── VAT Output Register ─────────────────────────────────────────────────────
  if (type === 'vat_register') {
    // ── Tax invoices ── (paginated — a wide period can exceed 1000 invoices,
    // which would silently understate output VAT and drop register rows)
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => admin
        .from('sales')
        .select('id, tax_serial, created_at, date_supply, customer_name, customer_tin, net_amount, vat_amount, total, payment_status, voided_at')
        .eq('vendor_id', vendor.id)
        .eq('document_type', 'tax_invoice')
        .in('invoice_entity_id', entityIds)
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('tax_serial', { ascending: true })
        .order('id')
        .range(from, to))
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to load invoices' }, { status: 500 })
    }

    // ── Credit notes issued in the same period ── (paginated)
    const creditNotes = await fetchAllRows((from, to) => admin
      .from('credit_notes')
      .select('credit_note_no, issued_at, customer_name, customer_tin, net_amount, vat_amount, total, original_serial, original_sale_id')
      .eq('vendor_id', vendor.id)
      .in('invoice_entity_id', entityIds)
      .gte('issued_at', fromTs)
      .lte('issued_at', toTs)
      .order('issued_at', { ascending: true })
      .order('credit_note_no')
      .range(from, to))
    const voidedOriginals = await voidedOriginalIds(admin, creditNotes)

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
      // Treat EITHER void signal as void — a row may carry payment_status='voided'
      // without voided_at (legacy), and the SSCL report keys on payment_status, so
      // both reports must agree or output VAT and SSCL turnover diverge.
      status:       (s.voided_at || s.payment_status === 'voided') ? 'VOID' : 'VALID',
    }))

    // Credit note rows — negative amounts, status = 'CRN'. When the original
    // invoice is VOID the void already removed its VAT, so the CRN is listed
    // for the record but contributes nothing (originalVoided → excluded).
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
      originalVoided: voidedOriginals.has(cn.original_sale_id),
    }))

    // Merge and sort by date
    const register = [...invoiceRows, ...cnRows].sort((a, b) =>
      new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime()
    )

    // Totals — valid invoices minus credit notes (CRNs against voided
    // invoices excluded: the void already reversed that VAT)
    const validInvoices = invoiceRows.filter(r => r.status === 'VALID')
    const countedCns    = cnRows.filter(r => !r.originalVoided)
    const totals = {
      netAmount:  validInvoices.reduce((s, r) => s + r.netAmount, 0) + countedCns.reduce((s, r) => s + r.netAmount, 0),
      vatAmount:  validInvoices.reduce((s, r) => s + r.vatAmount, 0) + countedCns.reduce((s, r) => s + r.vatAmount, 0),
      total:      validInvoices.reduce((s, r) => s + r.total, 0)     + countedCns.reduce((s, r) => s + r.total, 0),
      count:      validInvoices.length,
      voidCount:  invoiceRows.length - validInvoices.length,
      crnCount:   cnRows.length,
      crnExcludedCount: cnRows.length - countedCns.length,
    }

    return NextResponse.json({ register, totals, entity: lkTaxEntities[0].name, filing_valid: !branch, branch })
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

    // Get non-voided sales in range for lk_tax entities (paginated — turnover
    // would be understated if the period exceeds 1000 sales / line items)
    const sales = await fetchAllRows((from, to) => admin
      .from('sales')
      .select('id, created_at')
      .eq('vendor_id', vendor.id)
      .in('invoice_entity_id', entityIds)
      .neq('payment_status', 'voided')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)
      .order('id')
      .range(from, to))

    const saleIds = sales.map((s: any) => s.id)
    const saleDateMap: Record<string, string> = {}
    for (const s of sales) saleDateMap[s.id] = s.created_at

    // Aggregate by month × stream
    const monthMap: Record<string, { PART: number; SVC: number }> = {}

    if (saleIds.length > 0) {
      const items = await fetchAllByIds(saleIds, (ids, from, to) => admin
        .from('sale_items')
        .select('sale_id, sscl_stream, total')
        .in('sale_id', ids)
        .order('id')
        .range(from, to))

      for (const item of (items || [])) {
        const monthKey = colomboMonth(saleDateMap[item.sale_id])
        if (!monthMap[monthKey]) monthMap[monthKey] = { PART: 0, SVC: 0 }
        const stream = (item.sscl_stream || 'PART') as 'PART' | 'SVC'
        monthMap[monthKey][stream] += parseFloat(item.total || 0)
      }
    }

    // Credit notes reduce SSCL-liable turnover in the period they are ISSUED
    // (CLAUDE.md), per line-item stream. (paginated)
    const ssclCns = await fetchAllRows((from, to) => admin
      .from('credit_notes')
      .select('issued_at, original_sale_id, items:credit_note_items(sscl_stream, total)')
      .eq('vendor_id', vendor.id)
      .in('invoice_entity_id', entityIds)
      .gte('issued_at', fromTs)
      .lte('issued_at', toTs)
      .order('id')
      .range(from, to))
    // Voided originals are already excluded from the turnover above — their
    // CRNs must not subtract the same turnover a second time.
    const ssclVoided = await voidedOriginalIds(admin, ssclCns)

    for (const cn of (ssclCns || [])) {
      if (ssclVoided.has(cn.original_sale_id)) continue
      const monthKey = colomboMonth(cn.issued_at)
      if (!monthMap[monthKey]) monthMap[monthKey] = { PART: 0, SVC: 0 }
      for (const it of (cn.items || [])) {
        const stream = (it.sscl_stream || 'PART') as 'PART' | 'SVC'
        monthMap[monthKey][stream] -= parseFloat(it.total || 0)
      }
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
      filing_valid: !branch, branch,
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
      .gte('received_at', fromTs)
      .lte('received_at', toTs)
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
      const monthKey = colomboMonth(r.receivedAt)
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

    return NextResponse.json({ rows, months, totals, entity: lkTaxEntities[0].name, filing_valid: !branch, branch })
  }

  // ── VAT Summary (Output − Input = Net Payable) ─────────────────────────────
  if (type === 'vat_summary') {
    // ── Output VAT: valid invoices minus credit notes ── (both paginated so a
    // wide period with >1000 invoices/credit notes doesn't understate output VAT)
    const [invoices, creditNotes] = await Promise.all([
      fetchAllRows((from, to) => admin
        .from('sales')
        .select('id, net_amount, vat_amount, total, voided_at, payment_status')
        .eq('vendor_id', vendor.id)
        .eq('document_type', 'tax_invoice')
        .in('invoice_entity_id', entityIds)
        .gte('created_at', fromTs)
        .lte('created_at', toTs)
        .order('id')
        .range(from, to)),
      fetchAllRows((from, to) => admin
        .from('credit_notes')
        .select('id, net_amount, vat_amount, total, original_sale_id')
        .eq('vendor_id', vendor.id)
        .in('invoice_entity_id', entityIds)
        .gte('issued_at', fromTs)
        .lte('issued_at', toTs)
        .order('id')
        .range(from, to)),
    ])

    const validInvoices = (invoices || []).filter((s: any) => !s.voided_at && s.payment_status !== 'voided')
    // CRNs against voided invoices carry no VAT effect — the void already
    // removed that output VAT (counting both would reverse it twice).
    const summaryVoided = await voidedOriginalIds(admin, creditNotes)
    const countedCns    = (creditNotes || []).filter((c: any) => !summaryVoided.has(c.original_sale_id))
    const outputVatNet  = validInvoices.reduce((s: number, r: any) => s + parseInt(r.vat_amount || 0), 0)
    const outputVatCrn  = countedCns.reduce((s: number, r: any) => s + parseInt(r.vat_amount || 0), 0)
    const outputVat     = outputVatNet - outputVatCrn

    const outputNetSales = validInvoices.reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
                         - countedCns.reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
    const outputTotal    = validInvoices.reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)
                         - countedCns.reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)

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
      .gte('received_at', fromTs)
      .lte('received_at', toTs)

    const claimableGrns = (grns || []).filter((g: any) => g.supplier_vat_registered !== false)   // exclude known non-VAT suppliers
    const inputVat = claimableGrns.reduce((s: number, g: any) => s + parseInt(g.input_vat || 0), 0)
    // Legacy GRNs (created before the VAT-registered snapshot existed) are included
    // in inputVat but flagged so the accountant can verify them manually.
    const legacyCount = claimableGrns.filter((g: any) => g.supplier_vat_registered == null).length

    const netPayable = outputVat - inputVat

    return NextResponse.json({
      outputVat,
      outputNetSales,
      outputTotal,
      inputVat,
      legacyCount,
      netPayable,
      invoiceCount: validInvoices.length,
      crnCount:     (creditNotes || []).length,
      period:       { from, to },
      entity:       lkTaxEntities[0].name,
      filing_valid: !branch, branch,
    })
  }

  return NextResponse.json({ error: 'Unknown report type' }, { status: 400 })
}
