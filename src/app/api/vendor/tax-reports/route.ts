import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'
import { resolveBranch } from '@/lib/branchScope'
import { loadRateHistory, rateAsOf } from '@/lib/taxRates'

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
  if (vendor) return { ...vendor, branchScope: 'both', canFileTax: true, callerRole: 'owner' }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { ...staffLink.vendor, branchScope: staffLink.branch_scope || 'shop', canFileTax: staffLink.can_file_tax === true , callerRole: staffLink.role || 'cashier' }
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

  // Bad-debt events on insurance claims: a DEBT shortfall written off gives
  // VAT relief (and SSCL exclusion) in the period of the WRITE-OFF; a later
  // recovery adds both back in the period of the RECOVERY. The VAT share of
  // the written-off amount uses the original invoice's own ratio.
  async function badDebtEvents() {
    const { data: sfRows } = await admin.from('claim_shortfalls')
      .select('id, amount, written_off_at, recovered_at, status, sale_id, sale:sales!claim_shortfalls_sale_id_fkey(id, tax_serial, customer_name, customer_tin, net_amount, vat_amount, invoice_entity_id)')
      .eq('vendor_id', vendor.id)
      .not('sale_id', 'is', null)
      .in('status', ['written_off', 'recovered'])
    const events: any[] = []
    for (const sf of (sfRows || [])) {
      const sale: any = sf.sale
      if (!sale || !entityIds.includes(sale.invoice_entity_id)) continue
      const net = Number(sale.net_amount || 0), vat = Number(sale.vat_amount || 0)
      const vatShare = net + vat > 0 ? Math.round(Number(sf.amount) * vat / (net + vat)) : 0
      const base = {
        shortfallId: sf.id, saleId: sale.id, serial: sale.tax_serial,
        customerName: sale.customer_name, customerTin: sale.customer_tin || null,
        amount: Number(sf.amount), vatShare, netShare: Number(sf.amount) - vatShare,
      }
      if (sf.written_off_at && sf.written_off_at >= fromTs && sf.written_off_at <= toTs) {
        events.push({ ...base, kind: 'relief', at: sf.written_off_at })
      }
      if (sf.status === 'recovered' && sf.recovered_at && sf.recovered_at >= fromTs && sf.recovered_at <= toTs) {
        events.push({ ...base, kind: 'addback', at: sf.recovered_at })
      }
    }
    return events
  }

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

    // Bad-debt relief (write-offs) and add-backs (recoveries) of the period
    const bdEvents = await badDebtEvents()
    const bdRows = bdEvents.map((e: any) => ({
      rowType:      'bad_debt' as const,
      serial:       e.kind === 'relief' ? 'BAD DEBT' : 'RECOVERY',
      invoiceDate:  e.at,
      supplyDate:   null,
      customerName: e.customerName,
      customerTin:  e.customerTin,
      netAmount:    e.kind === 'relief' ? -e.netShare : e.netShare,
      vatAmount:    e.kind === 'relief' ? -e.vatShare : e.vatShare,
      total:        e.kind === 'relief' ? -e.amount : e.amount,
      status:       e.kind === 'relief' ? 'BAD DEBT' : 'RECOVERED',
      refSerial:    e.serial,
    }))

    // Merge and sort by date
    const register = [...invoiceRows, ...cnRows, ...bdRows].sort((a, b) =>
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
      badDebtRelief:   bdRows.filter(r => r.status === 'BAD DEBT').reduce((t, r) => t - r.vatAmount, 0),
      badDebtAddback:  bdRows.filter(r => r.status === 'RECOVERED').reduce((t, r) => t + r.vatAmount, 0),
    }
    totals.netAmount += bdRows.reduce((t, r) => t + r.netAmount, 0)
    totals.vatAmount += bdRows.reduce((t, r) => t + r.vatAmount, 0)
    totals.total     += bdRows.reduce((t, r) => t + r.total, 0)

    return NextResponse.json({ register, totals, entity: lkTaxEntities[0].name, filing_valid: !branch, branch })
  }

  // ── SSCL Liability Report ───────────────────────────────────────────────────
  if (type === 'sscl_report') {
    // Effective-dated rates: each month uses the rate in force THAT month, so
    // a rate change never rewrites an already-filed quarter.
    const rateHist = await loadRateHistory(admin, vendor.id)

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

    // Bad debt: a write-off EXCLUDES the shortfall's turnover in its period; a
    // recovery ADDS IT BACK in its own. Split per stream by the original
    // sale's line proportions so each side lands on the right liable base.
    const ssclBd = await badDebtEvents()
    if (ssclBd.length > 0) {
      const bdSaleIds = [...new Set(ssclBd.map((e: any) => e.saleId))]
      const { data: bdItems } = await admin.from('sale_items')
        .select('sale_id, sscl_stream, total').in('sale_id', bdSaleIds)
      const shares: Record<string, { PART: number; SVC: number }> = {}
      for (const it of (bdItems || [])) {
        if (!shares[it.sale_id]) shares[it.sale_id] = { PART: 0, SVC: 0 }
        shares[it.sale_id][(it.sscl_stream || 'PART') as 'PART' | 'SVC'] += parseFloat(it.total || 0)
      }
      for (const e of ssclBd) {
        const sh = shares[e.saleId] || { PART: 1, SVC: 0 }
        const tot = sh.PART + sh.SVC || 1
        const partShare = Math.round(e.amount * sh.PART / tot)
        const svcShare = e.amount - partShare
        const monthKey = colomboMonth(e.at)
        if (!monthMap[monthKey]) monthMap[monthKey] = { PART: 0, SVC: 0 }
        const sign = e.kind === 'relief' ? -1 : 1
        monthMap[monthKey].PART += sign * partShare
        monthMap[monthKey].SVC += sign * svcShare
      }
    }

    // Build report rows — rates as of each month
    const months = Object.keys(monthMap).sort().map(month => {
      const ssclRate       = rateAsOf(rateHist, 'sscl_rate', month, 2.5) / 100
      const liableBasePart = rateAsOf(rateHist, 'liable_base_part', month, 50) / 100
      const liableBaseSvc  = rateAsOf(rateHist, 'liable_base_svc', month, 100) / 100
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
      // Rates shown are those in force at the period end (per-month rates are
      // already applied inside each row).
      config: {
        ssclRate: rateAsOf(rateHist, 'sscl_rate', to.slice(0, 7), 2.5),
        liableBasePart: rateAsOf(rateHist, 'liable_base_part', to.slice(0, 7), 50),
        liableBaseSvc: rateAsOf(rateHist, 'liable_base_svc', to.slice(0, 7), 100),
      },
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
    //
    // DEFERRAL (standard SL practice): a credit doesn't have to be claimed in
    // the month of purchase. Claiming more input than output puts the company
    // in a refund position, which is slow to recover, so businesses carry
    // credits forward and claim them against a later month's output — within
    // 12 months (local purchases) or 24 months (imports). Each GRN therefore
    // carries the period it is CLAIMED in (vat_claim_period), defaulting to its
    // own month. We fetch a wide window and bucket by that claim period.
    const windowStart = new Date(new Date(fromTs).getTime() - 800 * 86400000).toISOString() // ~26 months back
    const { data: grns, error: grnsError } = await admin
      .from('grns')
      .select('id, grn_number, received_at, supplier_name, supplier_tin, supplier_vat_registered, supplier_invoice_no, net_cost, input_vat, total_cost, vat_claim_period, is_import')
      .eq('vendor_id', vendor.id)
      .eq('status', 'posted')
      .gt('input_vat', 0)
      .gte('received_at', windowStart)
      .lte('received_at', toTs)
      .order('received_at', { ascending: true })
      .order('created_at', { ascending: true })

    if (grnsError) return NextResponse.json({ error: grnsError.message }, { status: 500 })

    const fromMonth = from.slice(0, 7)
    const toMonth = to.slice(0, 7)
    const addMonths = (ym: string, n: number) => {
      const [y, m] = ym.split('-').map(Number)
      const d = new Date(y, m - 1 + n, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    const nowMonth = colomboMonth(new Date().toISOString())
    const shape = (g: any) => {
      const originMonth = colomboMonth(g.received_at)
      const claimPeriod = g.vat_claim_period || originMonth
      // Deadline: 12 months for local purchases, 24 for imports
      const expiryMonth = addMonths(originMonth, g.is_import ? 24 : 12)
      const monthsLeft = (() => {
        const [ey, em] = expiryMonth.split('-').map(Number)
        const [ny, nm] = nowMonth.split('-').map(Number)
        return (ey - ny) * 12 + (em - nm)
      })()
      return {
        id: g.id,
        grnNumber: g.grn_number,
        receivedAt: g.received_at,
        originMonth, claimPeriod, expiryMonth, monthsLeft,
        isImport: g.is_import === true,
        deferred: claimPeriod !== originMonth,
        supplierName: g.supplier_name || '—',
        supplierTin: g.supplier_tin || null,
        supplierVatRegistered: g.supplier_vat_registered ?? null,  // null = legacy GRN (pre-fix)
        supplierInvoiceNo: g.supplier_invoice_no || null,
        netCost: parseInt(g.net_cost || 0),
        inputVat: parseInt(g.input_vat || 0),
        totalCost: parseInt(g.total_cost || 0),
        claimable: g.supplier_vat_registered !== false,  // true for legacy + VAT-reg
      }
    }
    // ── Import VAT (Schedule 03) — one row per Customs declaration ──
    // Claimed by cusdec, never by item: a container holds thousands of parts
    // and the VAT is levied on the declaration. 24-month claim window.
    const { data: imports } = await admin
      .from('import_vat_entries')
      .select('*')
      .eq('vendor_id', vendor.id)
      .gte('cusdec_date', windowStart.slice(0, 10))
      .lte('cusdec_date', to)
      .order('cusdec_date', { ascending: true })

    const shapeImport = (im: any) => {
      const originMonth = String(im.cusdec_date).slice(0, 7)
      const claimPeriod = im.vat_claim_period || originMonth
      const expiryMonth = addMonths(originMonth, 24)
      const [ey, em] = expiryMonth.split('-').map(Number)
      const [ny, nm] = nowMonth.split('-').map(Number)
      const claimable = parseInt(im.vat_upfront || 0) + parseInt(im.vat_deferred || 0) - parseInt(im.disallowed_vat || 0)
      return {
        id: im.id, kind: 'import' as const,
        cusdecNo: im.cusdec_no, cusdecDate: im.cusdec_date,
        cusdecSerialId: im.cusdec_serial_id, cusdecRegDate: im.cusdec_reg_date,
        cusdecOfficeId: im.cusdec_office_id,
        vatDeferred: parseInt(im.vat_deferred || 0),
        vatUpfront: parseInt(im.vat_upfront || 0),
        disallowedVat: parseInt(im.disallowed_vat || 0),
        inputVat: claimable,
        supplier: im.supplier || null, reference: im.reference || null,
        originMonth, claimPeriod, expiryMonth,
        monthsLeft: (ey - ny) * 12 + (em - nm),
        deferred: claimPeriod !== originMonth,
      }
    }
    const allImports = (imports || []).map(shapeImport)
    const importRows = allImports.filter(r => r.claimPeriod >= fromMonth && r.claimPeriod <= toMonth)
    const importCarried = allImports.filter(r => r.claimPeriod > toMonth).sort((a, b) => a.monthsLeft - b.monthsLeft)
    const importTotals = {
      vatUpfront: importRows.reduce((s, r) => s + r.vatUpfront, 0),
      vatDeferred: importRows.reduce((s, r) => s + r.vatDeferred, 0),
      disallowed: importRows.reduce((s, r) => s + r.disallowedVat, 0),
      claimable: importRows.reduce((s, r) => s + r.inputVat, 0),
      count: importRows.length,
      carried: importCarried.reduce((s, r) => s + r.inputVat, 0),
    }

    const all = (grns || []).map(shape)
    // Claimed in this period = assigned claim period falls inside it
    const rows = all.filter(r => r.claimPeriod >= fromMonth && r.claimPeriod <= toMonth)
    // Still unclaimed = pushed past this period (carried forward pool)
    const carriedForward = all
      .filter(r => r.claimable && r.claimPeriod > toMonth)
      .sort((a, b) => a.monthsLeft - b.monthsLeft)
    const carriedTotal = carriedForward.reduce((s, r) => s + r.inputVat, 0)
    const expiringSoon = carriedForward.filter(r => r.monthsLeft <= 3)

    // Aggregate by month
    const monthMap: Record<string, { netCost: number; inputVat: number; totalCost: number; count: number }> = {}
    for (const r of rows) {
      const monthKey = r.claimPeriod
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

    return NextResponse.json({
      rows, months, totals, entity: lkTaxEntities[0].name, filing_valid: !branch, branch,
      carriedForward, carriedTotal, expiringSoonCount: expiringSoon.length,
      importRows, importCarried, importTotals,
      grandTotalInputVat: totals.inputVat + importTotals.claimable,
    })
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
    // Bad-debt relief cuts output VAT in its period; recovery restores it
    const sumBd = await badDebtEvents()
    const badDebtReliefVat  = sumBd.filter((e: any) => e.kind === 'relief').reduce((t: number, e: any) => t + e.vatShare, 0)
    const badDebtAddbackVat = sumBd.filter((e: any) => e.kind === 'addback').reduce((t: number, e: any) => t + e.vatShare, 0)
    const outputVat     = outputVatNet - outputVatCrn - badDebtReliefVat + badDebtAddbackVat

    const outputNetSales = validInvoices.reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
                         - countedCns.reduce((s: number, r: any) => s + parseInt(r.net_amount || 0), 0)
    const outputTotal    = validInvoices.reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)
                         - countedCns.reduce((s: number, r: any) => s + parseInt(r.total || 0), 0)

    // ── Input VAT: posted GRNs from VAT-registered suppliers only ──
    // supplier_vat_registered=false GRNs are excluded — those invoices are not
    // valid tax invoices and the IRD will disallow the claim.
    // supplier_vat_registered=null means legacy GRN (created before the column existed) —
    // included with a conservative assumption; accountant should verify those manually.
    // Input VAT is counted by the period it is CLAIMED in, not the purchase
    // month — credits can be carried forward (12 months local / 24 imports) to
    // avoid a refund position. Wide window, then bucket by claim period.
    const sumWindowStart = new Date(new Date(fromTs).getTime() - 800 * 86400000).toISOString()
    const { data: grns } = await admin
      .from('grns')
      .select('input_vat, supplier_vat_registered, received_at, vat_claim_period, is_import')
      .eq('vendor_id', vendor.id)
      .eq('status', 'posted')
      .gt('input_vat', 0)
      .gte('received_at', sumWindowStart)
      .lte('received_at', toTs)

    const sumFromMonth = from.slice(0, 7)
    const sumToMonth = to.slice(0, 7)
    const claimMonthOf = (g: any) => g.vat_claim_period || colomboMonth(g.received_at)
    const claimableGrns = (grns || []).filter((g: any) => g.supplier_vat_registered !== false)   // exclude known non-VAT suppliers
    const claimedThisPeriod = claimableGrns.filter((g: any) => {
      const cm = claimMonthOf(g)
      return cm >= sumFromMonth && cm <= sumToMonth
    })
    const inputVatLocal = claimedThisPeriod.reduce((s: number, g: any) => s + parseInt(g.input_vat || 0), 0)

    // Import VAT (Schedule 03) claimed in this period
    const { data: sumImports } = await admin
      .from('import_vat_entries')
      .select('vat_upfront, vat_deferred, disallowed_vat, cusdec_date, vat_claim_period')
      .eq('vendor_id', vendor.id)
      .gte('cusdec_date', sumWindowStart.slice(0, 10))
      .lte('cusdec_date', to)
    const importClaimMonth = (im: any) => im.vat_claim_period || String(im.cusdec_date).slice(0, 7)
    const importClaimable = (im: any) => parseInt(im.vat_upfront || 0) + parseInt(im.vat_deferred || 0) - parseInt(im.disallowed_vat || 0)
    const inputVatImport = (sumImports || [])
      .filter((im: any) => { const cm = importClaimMonth(im); return cm >= sumFromMonth && cm <= sumToMonth })
      .reduce((s: number, im: any) => s + importClaimable(im), 0)
    const importCarryForward = (sumImports || [])
      .filter((im: any) => importClaimMonth(im) > sumToMonth)
      .reduce((s: number, im: any) => s + importClaimable(im), 0)

    const inputVat = inputVatLocal + inputVatImport
    // Credits deliberately held back for a future month — shown so the figure
    // can be topped up when output VAT is high enough to absorb them
    const availableCarryForward = claimableGrns
      .filter((g: any) => claimMonthOf(g) > sumToMonth)
      .reduce((s: number, g: any) => s + parseInt(g.input_vat || 0), 0) + importCarryForward
    // Legacy GRNs (created before the VAT-registered snapshot existed) are included
    // in inputVat but flagged so the accountant can verify them manually.
    const legacyCount = claimedThisPeriod.filter((g: any) => g.supplier_vat_registered == null).length

    const netPayable = outputVat - inputVat

    return NextResponse.json({
      outputVat,
      outputNetSales,
      outputTotal,
      inputVat,
      inputVatLocal,
      inputVatImport,
      availableCarryForward,
      legacyCount,
      netPayable,
      badDebtReliefVat, badDebtAddbackVat,
      invoiceCount: validInvoices.length,
      crnCount:     (creditNotes || []).length,
      period:       { from, to },
      entity:       lkTaxEntities[0].name,
      filing_valid: !branch, branch,
    })
  }

  // ── Aged shortfalls by classification ─────────────────────────────────────
  if (type === 'shortfall_aging') {
    const { data: sfRows } = await admin.from('claim_shortfalls')
      .select('id, amount, classification, status, reason_code, approved_by, created_at, written_off_at, sale:sales!claim_shortfalls_sale_id_fkey(tax_serial, invoice_no, customer_name), bill:claim_third_party_bills!claim_shortfalls_bill_id_fkey(supplier_name, bill_ref), claim:insurance_claims(claim_no, vehicle_no)')
      .eq('vendor_id', vendor.id)
      .order('created_at')
    const now = Date.now()
    const rows = (sfRows || []).map((sf: any) => {
      const ageDays = Math.floor((now - new Date(sf.created_at).getTime()) / 86400000)
      return {
        id: sf.id,
        doc: sf.sale ? (sf.sale.tax_serial || sf.sale.invoice_no) : sf.bill ? sf.bill.supplier_name + (sf.bill.bill_ref ? ' · ' + sf.bill.bill_ref : '') : '—',
        customer: sf.sale?.customer_name || null,
        claimNo: sf.claim?.claim_no || null,
        vehicle: sf.claim?.vehicle_no || null,
        amount: Number(sf.amount),
        classification: sf.classification,
        status: sf.status,
        reasonCode: sf.reason_code,
        approvedBy: sf.approved_by,
        ageDays,
        bucket: ageDays <= 30 ? '0-30' : ageDays <= 90 ? '31-90' : ageDays <= 180 ? '91-180' : '180+',
        // DEBT older than 6 months: the system suggests the owner write it off
        suggestWriteOff: sf.classification === 'DEBT' && sf.status === 'actioned' && ageDays > 180,
      }
    })
    const byClass: Record<string, { count: number; amount: number }> = {}
    for (const r of rows) {
      const k = r.classification || 'UNCLASSIFIED'
      if (!byClass[k]) byClass[k] = { count: 0, amount: 0 }
      byClass[k].count++; byClass[k].amount += r.amount
    }
    return NextResponse.json({ rows, byClass, filing_valid: !branch, branch })
  }

  return NextResponse.json({ error: 'Unknown report type' }, { status: 400 })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — move input VAT credits between periods (the deferral practice).
// { action: 'set_claim_period', grnIds: string[], period: 'YYYY-MM' | null }
// null restores a GRN to its own purchase month. Rejects a period beyond the
// legal window (12 months local / 24 imports) so a credit can't be parked
// until it expires.
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(vendor as any).canFileTax) {
    return NextResponse.json({ error: 'Only the owner or a login with tax-filing access can move VAT credits' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const admin0 = createAdminClient()

  // ── Import VAT (Schedule 03) entries ──────────────────────────────────────
  // Deleting a claimed import-VAT entry rewrites the VAT return. Owner/manager
  // only — any active login could do it before the 2026-09-02 review.
  if (body.action === 'delete_import_vat' && !roleAllows((vendor as any).callerRole, ['owner', 'manager'])) return forbidden('delete_import_vat', ['owner', 'manager'])
  if (body.action === 'add_import_vat') {
    // Accepts one entry or many (the IRD Schedule 03 CSV parsed client-side)
    const entries = Array.isArray(body.entries) ? body.entries : [body.entry]
    const rows = entries.filter(Boolean).map((e: any) => ({
      vendor_id: vendor.id,
      cusdec_no: String(e.cusdecNo || '').trim(),
      cusdec_date: e.cusdecDate,
      cusdec_serial_id: e.cusdecSerialId || null,
      cusdec_reg_date: e.cusdecRegDate || null,
      cusdec_office_id: e.cusdecOfficeId || null,
      vat_deferred: Math.round(Number(e.vatDeferred) || 0),
      vat_upfront: Math.round(Number(e.vatUpfront) || 0),
      disallowed_vat: Math.round(Number(e.disallowedVat) || 0),
      supplier: e.supplier?.trim() || null,
      reference: e.reference?.trim() || null,
      notes: e.notes?.trim() || null,
      created_by: (vendor as any).email || null,
    }))
    const bad = rows.find((r: any) => !r.cusdec_no || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.cusdec_date || '')))
    if (bad) return NextResponse.json({ error: 'Every row needs a Cusdec number and a valid date' }, { status: 400 })
    // Re-uploading the same schedule updates rather than duplicates
    const { error } = await admin0.from('import_vat_entries').upsert(rows, { onConflict: 'vendor_id,cusdec_no,cusdec_date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true, saved: rows.length })
  }

  if (body.action === 'delete_import_vat') {
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { error } = await admin0.from('import_vat_entries').delete().eq('id', body.id).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'set_import_claim_period') {
    const { id, period } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (period !== null && !/^\d{4}-\d{2}$/.test(String(period || ''))) {
      return NextResponse.json({ error: 'period must be YYYY-MM or null' }, { status: 400 })
    }
    const { data: im } = await admin0.from('import_vat_entries').select('cusdec_date, cusdec_no').eq('id', id).eq('vendor_id', vendor.id).single()
    if (!im) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    if (period) {
      const originMonth = String(im.cusdec_date).slice(0, 7)
      const [y, m] = originMonth.split('-').map(Number)
      const lim = new Date(y, m - 1 + 24, 1)
      const limit = `${lim.getFullYear()}-${String(lim.getMonth() + 1).padStart(2, '0')}`
      if (period < originMonth) return NextResponse.json({ error: `Cannot claim before the Cusdec month (${originMonth})` }, { status: 400 })
      if (period > limit) return NextResponse.json({ error: `${im.cusdec_no}: past the 24-month import deadline (${limit})` }, { status: 400 })
    }
    const { error } = await admin0.from('import_vat_entries').update({ vat_claim_period: period }).eq('id', id).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (body.action !== 'set_claim_period') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const { grnIds, period } = body
  if (!Array.isArray(grnIds) || grnIds.length === 0) return NextResponse.json({ error: 'grnIds required' }, { status: 400 })
  if (period !== null && !/^\d{4}-\d{2}$/.test(String(period || ''))) {
    return NextResponse.json({ error: 'period must be YYYY-MM or null' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: grns } = await admin
    .from('grns')
    .select('id, received_at, is_import, grn_number')
    .eq('vendor_id', vendor.id)
    .in('id', grnIds)
  if (!grns || grns.length === 0) return NextResponse.json({ error: 'No matching GRNs' }, { status: 404 })

  if (period) {
    const addMonths = (ym: string, n: number) => {
      const [y, m] = ym.split('-').map(Number)
      const d = new Date(y, m - 1 + n, 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    }
    for (const g of grns) {
      const originMonth = colomboMonth(g.received_at)
      if (period < originMonth) {
        return NextResponse.json({ error: `${g.grn_number}: a credit cannot be claimed before the purchase month (${originMonth})` }, { status: 400 })
      }
      const limit = addMonths(originMonth, g.is_import ? 24 : 12)
      if (period > limit) {
        return NextResponse.json({
          error: `${g.grn_number}: ${period} is past the claim deadline (${limit}) — ${g.is_import ? 'imports: 24 months' : 'local purchases: 12 months'}`,
        }, { status: 400 })
      }
    }
  }

  const { error } = await admin
    .from('grns')
    .update({ vat_claim_period: period })
    .eq('vendor_id', vendor.id)
    .in('id', grnIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, updated: grns.length, period })
}
