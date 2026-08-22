import { NextRequest, NextResponse } from 'next/server'
import { missingVatPaperwork } from '@/lib/vatPaperwork'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// VAT Filing Centre — everything one taxable period needs, in one call.
//
// Returns the four IRD schedules' rows (01 output, 02 local input, 03 imports,
// 04 credit/debit notes), the resulting liability, and the deferral state:
// which input credits are parked in future months and which are running out of
// time (12 months for local purchases, 24 for imports).
//
// The Pvt Ltd is ONE taxpayer: figures here are always whole-company across
// every serial stream (PART shop + REPR workshop). Never branch-filtered.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner', canFileTax: true, email: user.email || '' }
  const { data: s } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (s?.vendor) return { vendor: s.vendor, role: s.role || 'cashier', canFileTax: s.can_file_tax === true, email: user.email || '' }
  return null
}

const monthOf = (d: string) => String(d || '').slice(0, 7)
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthsBetween = (from: string, to: string) => {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

// The figures that go to IRD are the owner's alone, unless the owner has
// explicitly delegated filing to a staff member (vendor_staff.can_file_tax).
const canFile = (c: { role: string; canFileTax: boolean }) => c.role === 'owner' || c.canFileTax === true

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canFile(caller)) {
    return NextResponse.json({ error: 'Tax filing is restricted to the owner or a staff member authorised to file' }, { status: 403 })
  }

  const admin = createAdminClient()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })

  const from = `${period}-01`
  const [py, pm] = period.split('-').map(Number)
  const to = new Date(py, pm, 0).toLocaleDateString('en-CA')  // last day of the month
  const fromTs = new Date(`${from}T00:00:00+05:30`).toISOString()
  const toTs = new Date(`${to}T23:59:59.999+05:30`).toISOString()
  const nowMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7)

  // lk_tax entities — ALL of them (one TIN files one return)
  const { data: entities } = await admin.from('invoice_entities')
    .select('id, name, tin, address').eq('vendor_id', caller.vendor.id).eq('invoice_mode', 'lk_tax')
  const entityIds = (entities || []).map((e: any) => e.id)
  if (entityIds.length === 0) return NextResponse.json({ error: 'No VAT entity configured' }, { status: 400 })

  // ── Schedule 01: output tax invoices issued in the period ──
  const { data: salesRows, error: salesErr } = await admin.from('sales')
    .select('id, tax_serial, created_at, date_supply, customer_name, customer_tin, net_amount, vat_amount, total, payment_status, voided_at')
    .eq('vendor_id', caller.vendor.id)
    .eq('document_type', 'tax_invoice')
    .in('invoice_entity_id', entityIds)
    .gte('created_at', fromTs).lte('created_at', toTs)
    .order('tax_serial')
  if (salesErr) return NextResponse.json({ error: 'Sales: ' + salesErr.message }, { status: 500 })
  const schedule01 = (salesRows || [])
    .filter((s: any) => !s.voided_at && s.payment_status !== 'voided' && s.tax_serial)
    .map((s: any) => ({
      invoiceDate: s.date_supply || String(s.created_at).slice(0, 10),
      taxInvoiceNo: s.tax_serial,
      purchaserTin: s.customer_tin || '',
      purchaserName: s.customer_name || '',
      valueOfSupply: parseInt(s.net_amount || 0),
      vatAmount: parseInt(s.vat_amount || 0),
    }))
  const outputVat = schedule01.reduce((sum: number, r: any) => sum + r.vatAmount, 0)
  const outputNet = schedule01.reduce((sum: number, r: any) => sum + r.valueOfSupply, 0)

  // ── Input credits: local GRNs + import Cusdecs ──
  // A credit belongs to the period named by its claim period (its own month
  // unless it was deliberately moved). Look back over the full claim window so
  // credits parked earlier still surface.
  const localWindowStart = addMonths(period, -12) + '-01'
  const { data: grns, error: grnErr } = await admin.from('grns')
    .select('id, grn_number, received_at, supplier_name, supplier_tin, supplier_vat_registered, supplier_invoice_no, supplier_invoice_date, net_cost, input_vat, disallowed_vat, vat_claim_period')
    .eq('vendor_id', caller.vendor.id).eq('status', 'posted').gt('input_vat', 0)
    .gte('received_at', localWindowStart)
    .order('received_at')
  if (grnErr) return NextResponse.json({ error: 'GRNs: ' + grnErr.message }, { status: 500 })

  // Overheads and consumables with a supplier tax invoice — same 12-month
  // window as any other local purchase.
  const { data: expenses, error: expErr } = await admin.from('expenses')
    .select('id, expense_date, category, description, supplier_name, supplier_tin, supplier_invoice_no, supplier_invoice_date, amount, input_vat, vat_claim_period')
    .eq('vendor_id', caller.vendor.id).gt('input_vat', 0)
    .gte('expense_date', localWindowStart)
    .order('expense_date')
  if (expErr) return NextResponse.json({ error: 'Expenses: ' + expErr.message }, { status: 500 })

  const importWindowStart = addMonths(period, -24) + '-01'
  const { data: imports, error: impErr } = await admin.from('import_vat_entries')
    .select('*').eq('vendor_id', caller.vendor.id)
    .gte('cusdec_date', importWindowStart)
    .order('cusdec_date')
  if (impErr) return NextResponse.json({ error: 'Import VAT: ' + impErr.message }, { status: 500 })

  const localItems = (grns || [])
    .filter((g: any) => g.supplier_vat_registered !== false)
    .map((g: any) => {
      const originMonth = monthOf(g.received_at)
      const claimPeriod = g.vat_claim_period || originMonth
      const deadline = addMonths(originMonth, 12)
      return {
        kind: 'local' as const, id: g.id, ref: g.grn_number,
        // Schedule 02 wants the SUPPLIER's invoice date; fall back to the date
        // we received the goods when the invoice date wasn't captured.
        invoiceDate: g.supplier_invoice_date || String(g.received_at).slice(0, 10),
        invoiceNo: g.supplier_invoice_no || '',
        missingInvoiceInfo: missingVatPaperwork(g).length > 0,
        missingFields: missingVatPaperwork(g),
        partyTin: g.supplier_tin || '', partyName: g.supplier_name || '',
        value: parseInt(g.net_cost || 0), vat: parseInt(g.input_vat || 0),
        disallowedVat: parseInt(g.disallowed_vat || 0),
        originMonth, claimPeriod, deadline,
        monthsLeft: monthsBetween(nowMonth, deadline),
      }
    })

  const importItems = (imports || []).map((im: any) => {
    const originMonth = monthOf(im.cusdec_date)
    const claimPeriod = im.vat_claim_period || originMonth
    const deadline = addMonths(originMonth, 24)
    return {
      kind: 'import' as const, id: im.id, ref: im.cusdec_no,
      invoiceDate: String(im.cusdec_date).slice(0, 10),
      cusdecSerialId: im.cusdec_serial_id, cusdecRegDate: im.cusdec_reg_date, cusdecOfficeId: im.cusdec_office_id,
      vatDeferred: parseInt(im.vat_deferred || 0), vatUpfront: parseInt(im.vat_upfront || 0),
      disallowedVat: parseInt(im.disallowed_vat || 0),
      partyName: im.supplier || '', partyTin: '',
      value: 0,
      vat: parseInt(im.vat_upfront || 0) + parseInt(im.vat_deferred || 0) - parseInt(im.disallowed_vat || 0),
      originMonth, claimPeriod, deadline,
      monthsLeft: monthsBetween(nowMonth, deadline),
    }
  })

  const expenseItems = (expenses || []).map((e: any) => {
    const invoiceDate = e.supplier_invoice_date || String(e.expense_date).slice(0, 10)
    const originMonth = monthOf(invoiceDate)
    const claimPeriod = e.vat_claim_period || originMonth
    const deadline = addMonths(originMonth, 12)
    const vat = parseInt(e.input_vat || 0)
    return {
      kind: 'expense' as const, id: e.id,
      ref: e.supplier_invoice_no || e.description,
      invoiceDate, invoiceNo: e.supplier_invoice_no || '',
      missingInvoiceInfo: !e.supplier_invoice_no || !e.supplier_tin,
      missingFields: missingVatPaperwork(e),
      partyTin: e.supplier_tin || '', partyName: e.supplier_name || e.description || '',
      // The amount paid is VAT-inclusive; Schedule 02 wants the value excluding it
      value: Math.round(parseInt(e.amount || 0) - vat), vat,
      disallowedVat: 0,
      category: e.category,
      originMonth, claimPeriod, deadline,
      monthsLeft: monthsBetween(nowMonth, deadline),
    }
  })

  const allInput = [...localItems, ...expenseItems, ...importItems]
  const claimedNow = allInput.filter(i => i.claimPeriod === period)
  const parkedLater = allInput.filter(i => i.claimPeriod > period).sort((a, b) => a.monthsLeft - b.monthsLeft)
  const inputVat = claimedNow.reduce((s, i) => s + i.vat, 0)

  // ── Schedule 04: credit notes issued to customers in the period ──
  const { data: crns, error: crnErr } = await admin.from('credit_notes')
    .select('credit_note_no, issued_at, original_serial, original_sale_id, customer_name, customer_tin, net_amount, vat_amount')
    .eq('vendor_id', caller.vendor.id)
    .gte('issued_at', fromTs).lte('issued_at', toTs)
    .order('credit_note_no')
  if (crnErr) return NextResponse.json({ error: 'Credit notes: ' + crnErr.message }, { status: 500 })
  // The original invoice's date is needed for the schedule's "Invoice Date"
  const origIds = [...new Set((crns || []).map((c: any) => c.original_sale_id).filter(Boolean))]
  const origDates: Record<string, string> = {}
  if (origIds.length > 0) {
    const { data: origs } = await admin.from('sales').select('id, date_supply, created_at').in('id', origIds)
    for (const o of (origs || [])) origDates[o.id] = o.date_supply || String(o.created_at).slice(0, 10)
  }
  const schedule04 = (crns || []).map((c: any) => ({
    tin: c.customer_tin || '',
    invoiceDate: origDates[c.original_sale_id] || '',
    invoiceNo: c.original_serial || '',
    noteType: 'Credit',
    noteDate: String(c.issued_at).slice(0, 10),
    noteNo: c.credit_note_no,
    value: parseInt(c.net_amount || 0),
    vatAmount: parseInt(c.vat_amount || 0),
    issuedByMe: 'Yes',
  }))
  const crnVat = schedule04.reduce((s: number, r: any) => s + r.vatAmount, 0)

  // Credit notes the SUPPLIER issued to us (goods returned to a local supplier).
  // Same schedule, "Issued By Me = No" — they reduce input VAT, not output.
  // Only returns where the supplier's credit note has actually been received and
  // recorded belong on the return.
  const { data: supRets, error: supErr } = await admin.from('supplier_returns')
    .select('return_no, supplier_credit_note_no, supplier_credit_note_date, supplier_invoice_no, supplier_invoice_date, credit_vat, total_amount, supplier:suppliers(name, tin)')
    .eq('vendor_id', caller.vendor.id)
    .not('supplier_credit_note_no', 'is', null)
    .gte('supplier_credit_note_date', from).lte('supplier_credit_note_date', to)
    .order('supplier_credit_note_date')
  if (supErr) return NextResponse.json({ error: 'Supplier credit notes: ' + supErr.message }, { status: 500 })
  const schedule04Supplier = (supRets || []).map((r: any) => ({
    tin: r.supplier?.tin || '',
    invoiceDate: r.supplier_invoice_date || '',
    invoiceNo: r.supplier_invoice_no || '',
    noteType: 'Credit',
    noteDate: String(r.supplier_credit_note_date).slice(0, 10),
    noteNo: r.supplier_credit_note_no,
    value: parseInt(r.total_amount || 0),
    vatAmount: parseInt(r.credit_vat || 0),
    issuedByMe: 'No',
    _ref: r.return_no,
    _party: r.supplier?.name || '',
  }))
  // Credit notes for discounts and price adjustments — nothing came back off
  // the shelf, so these never touch the returns flow, but they reduce input
  // VAT exactly the same way and belong on the same schedule.
  const { data: supCns, error: supCnErr } = await admin.from('supplier_credit_notes')
    .select('credit_note_no, credit_note_date, invoice_no, invoice_date, net_amount, vat_amount, reason, supplier:suppliers(name, tin)')
    .eq('vendor_id', caller.vendor.id)
    .gte('credit_note_date', from).lte('credit_note_date', to)
    .order('credit_note_date')
  if (supCnErr) return NextResponse.json({ error: 'Supplier credit notes: ' + supCnErr.message }, { status: 500 })
  for (const c of (supCns || []) as any[]) {
    schedule04Supplier.push({
      tin: c.supplier?.tin || '',
      invoiceDate: c.invoice_date || '',
      invoiceNo: c.invoice_no || '',
      noteType: 'Credit',
      noteDate: String(c.credit_note_date).slice(0, 10),
      noteNo: c.credit_note_no,
      value: parseInt(c.net_amount || 0),
      vatAmount: parseInt(c.vat_amount || 0),
      issuedByMe: 'No',
      _ref: c.reason,
      _party: c.supplier?.name || '',
    })
  }

  const supplierCrnVat = schedule04Supplier.reduce((s: number, r: any) => s + r.vatAmount, 0)

  // Output VAT is reduced by credit notes issued in this period
  const netOutputVat = outputVat - crnVat
  // …and reduced further on the input side by what suppliers credited back
  const netInputVat = inputVat - supplierCrnVat
  const netPayable = netOutputVat - netInputVat

  return NextResponse.json({
    period, from, to,
    entity: entities?.[0] || null,
    canFileTax: caller.canFileTax,
    schedule01,
    schedule04: [...schedule04, ...schedule04Supplier],
    schedule04Supplier,
    input: {
      claimedNow, parkedLater,
      expiringSoon: allInput.filter(i => i.claimPeriod > period && i.monthsLeft <= 3),
    },
    totals: {
      outputNet, outputVat, crnVat, netOutputVat,
      inputVat, supplierCrnVat, netInputVat,
      inputLocal: claimedNow.filter(i => i.kind === 'local').reduce((s, i) => s + i.vat, 0),
      inputExpense: claimedNow.filter(i => i.kind === 'expense').reduce((s, i) => s + i.vat, 0),
      inputImport: claimedNow.filter(i => i.kind === 'import').reduce((s, i) => s + i.vat, 0),
      netPayable,
      parkedTotal: parkedLater.reduce((s, i) => s + i.vat, 0),
      invoiceCount: schedule01.length,
      crnCount: schedule04.length + schedule04Supplier.length,
    },
  })
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canFile(caller)) {
    return NextResponse.json({ error: 'Tax filing is restricted to the owner or a staff member authorised to file' }, { status: 403 })
  }
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))

  // Move a batch of input credits to another period (or back to their own
  // month with period=null). Every item is checked against its deadline —
  // 12 months from a local purchase, 24 from a Cusdec — and the whole batch is
  // rejected if any item would expire, naming the offenders.
  if (body.action === 'move_credits') {
    const { items, period } = body as { items: { kind: string; id: string }[]; period: string | null }
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'No items selected' }, { status: 400 })
    if (period !== null && !/^\d{4}-\d{2}$/.test(String(period || ''))) {
      return NextResponse.json({ error: 'period must be YYYY-MM or null' }, { status: 400 })
    }

    const localIds = items.filter(i => i.kind === 'local').map(i => i.id)
    const expenseIds = items.filter(i => i.kind === 'expense').map(i => i.id)
    const importIds = items.filter(i => i.kind === 'import').map(i => i.id)
    const problems: string[] = []

    if (localIds.length > 0) {
      const { data: rows } = await admin.from('grns').select('id, grn_number, received_at')
        .eq('vendor_id', caller.vendor.id).in('id', localIds)
      for (const r of (rows || [])) {
        const origin = monthOf(r.received_at)
        if (period && period < origin) problems.push(`${r.grn_number}: cannot claim before ${origin}`)
        else if (period && period > addMonths(origin, 12)) problems.push(`${r.grn_number}: past the 12-month deadline (${addMonths(origin, 12)})`)
      }
    }
    if (expenseIds.length > 0) {
      const { data: rows } = await admin.from('expenses')
        .select('id, description, expense_date, supplier_invoice_date, supplier_invoice_no')
        .eq('vendor_id', caller.vendor.id).in('id', expenseIds)
      for (const r of (rows || [])) {
        const label = r.supplier_invoice_no || r.description
        const origin = monthOf(r.supplier_invoice_date || r.expense_date)
        if (period && period < origin) problems.push(`${label}: cannot claim before ${origin}`)
        else if (period && period > addMonths(origin, 12)) problems.push(`${label}: past the 12-month deadline (${addMonths(origin, 12)})`)
      }
    }
    if (importIds.length > 0) {
      const { data: rows } = await admin.from('import_vat_entries').select('id, cusdec_no, cusdec_date')
        .eq('vendor_id', caller.vendor.id).in('id', importIds)
      for (const r of (rows || [])) {
        const origin = monthOf(r.cusdec_date)
        if (period && period < origin) problems.push(`Cusdec ${r.cusdec_no}: cannot claim before ${origin}`)
        else if (period && period > addMonths(origin, 24)) problems.push(`Cusdec ${r.cusdec_no}: past the 24-month deadline (${addMonths(origin, 24)})`)
      }
    }
    if (problems.length > 0) return NextResponse.json({ error: problems.join(' · ') }, { status: 400 })

    if (localIds.length > 0) {
      const { error } = await admin.from('grns').update({ vat_claim_period: period })
        .eq('vendor_id', caller.vendor.id).in('id', localIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (expenseIds.length > 0) {
      const { error } = await admin.from('expenses').update({ vat_claim_period: period })
        .eq('vendor_id', caller.vendor.id).in('id', expenseIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (importIds.length > 0) {
      const { error } = await admin.from('import_vat_entries').update({ vat_claim_period: period })
        .eq('vendor_id', caller.vendor.id).in('id', importIds)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true, moved: items.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
