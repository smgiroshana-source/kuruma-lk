import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/fetchAll'
import { netOfVat } from '@/lib/margin'

// ─────────────────────────────────────────────────────────────────────────────
// Profit report — the numbers behind the PDF.
//
// The three-way cost model (owner rule, Aug 2026) decides which bucket a sold
// line lands in:
//   REAL   — the sale-time FIFO snapshot, or a firm product cost entered later
//   ROUGH  — a product cost flagged as an estimate (cost_is_estimate)
//   NO COST— nothing to compare against: revenue is reported, profit is NOT
//            invented. These are listed separately so the owner can see how
//            much of the period's takings the profit figure cannot speak for.
//
// VAT: for a VAT entity the sale price includes 18%, which is the IRD's money,
// not margin — revenue is taken net of VAT so the profit isn't overstated.
// Owner/manager only: this is the whole business's margin.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner' }
  const { data: s } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (s?.vendor) return { vendor: s.vendor, role: s.role || 'cashier' }
  return null
}

const r0 = (n: any) => Math.round(Number(n) || 0)

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (caller.role !== 'owner' && caller.role !== 'manager') {
    return NextResponse.json({ error: 'Profit figures are owner/manager only' }, { status: 403 })
  }
  const admin = createAdminClient()
  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'from and to are required (YYYY-MM-DD)' }, { status: 400 })
  }
  const fromTs = new Date(`${from}T00:00:00+05:30`).toISOString()
  const toTs = new Date(`${to}T23:59:59.999+05:30`).toISOString()

  const { data: settings } = await admin.from('vendor_settings')
    .select('invoice_mode, invoice_title, tax_id').eq('vendor_id', caller.vendor.id).single()
  const isVatEntity = settings?.invoice_mode === 'lk_tax'
  const { data: cfg } = await admin.from('tax_config')
    .select('key, value').eq('vendor_id', caller.vendor.id).eq('key', 'vat_rate').maybeSingle()
  const vatRate = cfg?.value != null ? parseFloat(cfg.value) : 18
  // Only a tax invoice carries VAT; a Proprietor receipt doesn't.
  const net = (amount: number, docType: string) =>
    isVatEntity && docType === 'tax_invoice' ? netOfVat(amount, vatRate) : amount

  // Every non-void sale in the window, with its lines
  const sales = await fetchAllRows((a, b) => admin
    .from('sales')
    .select('id, invoice_no, tax_serial, receipt_no, created_at, customer_name, document_type, payment_status, items:sale_items(product_sku, product_name, quantity, returned_quantity, unit_price, unit_cost, sscl_stream)')
    .eq('vendor_id', caller.vendor.id)
    .neq('payment_status', 'voided')
    .neq('payment_status', 'draft')
    .gte('created_at', fromTs).lte('created_at', toTs)
    .order('created_at').range(a, b))

  // Product costs for lines with no sale-time snapshot
  const { data: products } = await admin.from('products')
    .select('sku, cost, cost_is_estimate').eq('vendor_id', caller.vendor.id)
  const prodBySku = new Map((products || []).filter((p: any) => p.sku).map((p: any) => [p.sku, p]))

  type Row = {
    date: string; invoice: string; customer: string
    sku: string; name: string; qty: number
    revenue: number; cost: number; profit: number
    basis: 'real' | 'rough' | 'service' | 'none'
  }
  const detail: Row[] = []
  const noCostAgg = new Map<string, { sku: string; name: string; qty: number; revenue: number }>()
  const productAgg = new Map<string, { sku: string; name: string; qty: number; revenue: number; cost: number; profit: number; rough: boolean }>()

  let realRev = 0, realCogs = 0, roughRev = 0, roughCogs = 0, serviceRev = 0, noCostRev = 0
  let noCostQty = 0

  for (const s of (sales || [])) {
    const docType = s.document_type || 'receipt'
    const invoice = s.tax_serial || s.invoice_no || s.receipt_no || ''
    const date = String(s.created_at).slice(0, 10)
    for (const i of (s.items || [])) {
      if (i.product_sku === 'OPENING-BAL') continue
      const qty = Number(i.quantity) - Number(i.returned_quantity || 0)
      if (qty <= 0) continue
      const gross = qty * parseFloat(i.unit_price || 0)
      const revenue = r0(net(gross, docType))

      const snap = i.unit_cost != null && parseInt(i.unit_cost) > 0 ? parseInt(i.unit_cost) : null
      const prod: any = i.product_sku ? prodBySku.get(i.product_sku) : null
      let cost = 0
      let basis: Row['basis']

      if (snap != null) {
        cost = snap * qty; basis = 'real'
        realRev += revenue; realCogs += cost
      } else if (!i.product_sku) {
        // A typed service line has no COGS — the whole net amount is margin
        basis = 'service'
        serviceRev += revenue
      } else if (prod && parseInt(prod.cost) > 0) {
        cost = parseInt(prod.cost) * qty
        if (prod.cost_is_estimate) { basis = 'rough'; roughRev += revenue; roughCogs += cost }
        else { basis = 'real'; realRev += revenue; realCogs += cost }
      } else {
        basis = 'none'
        noCostRev += revenue; noCostQty += qty
        const k = i.product_sku || i.product_name
        const e = noCostAgg.get(k) || { sku: i.product_sku || '', name: i.product_name, qty: 0, revenue: 0 }
        e.qty += qty; e.revenue += revenue
        noCostAgg.set(k, e)
      }

      detail.push({
        date, invoice, customer: s.customer_name || 'Walk-in',
        sku: i.product_sku || '', name: i.product_name, qty,
        revenue, cost: r0(cost), profit: basis === 'none' ? 0 : r0(revenue - cost), basis,
      })

      if (basis !== 'none') {
        const k = i.product_sku || i.product_name
        const e = productAgg.get(k) || { sku: i.product_sku || '', name: i.product_name, qty: 0, revenue: 0, cost: 0, profit: 0, rough: false }
        e.qty += qty; e.revenue += revenue; e.cost += r0(cost); e.profit += r0(revenue - cost)
        if (basis === 'rough') e.rough = true
        productAgg.set(k, e)
      }
    }
  }

  // Operating expenses in the window — the gap between gross and net profit.
  // Movements (owner/bank) are not expenses and never appear here.
  const { data: expenseRows } = await admin.from('expenses')
    .select('category, amount, input_vat')
    .eq('vendor_id', caller.vendor.id)
    .gte('expense_date', from).lte('expense_date', to)
  const expenseByCat = new Map<string, number>()
  let expenseTotal = 0
  for (const e of (expenseRows || [])) {
    // Claimable input VAT is recovered from IRD, so the cost to the business
    // is the amount net of it.
    const netAmt = r0(Number(e.amount || 0) - Number(e.input_vat || 0))
    expenseByCat.set(e.category, (expenseByCat.get(e.category) || 0) + netAmt)
    expenseTotal += netAmt
  }

  // Stock written off in the window — lost, damaged, stolen.
  //
  // This cost belongs in neither COGS (it was never sold) nor expenses, so
  // until now it fell out of the arithmetic entirely: goods left the shelf and
  // profit did not move. It is a real loss of the period and is shown on its
  // own line rather than buried in expenses, because the owner needs to see
  // how much stock is walking out unsold.
  const { data: writeoffRows } = await admin.from('stock_writeoffs')
    .select('writeoff_no, writeoff_date, reason, total_cost, status')
    .eq('vendor_id', caller.vendor.id).eq('status', 'posted')
    .gte('writeoff_date', from).lte('writeoff_date', to)
  const writeoffByReason = new Map<string, number>()
  let writeoffTotal = 0
  for (const w of (writeoffRows || [])) {
    const amt = r0(w.total_cost)
    writeoffByReason.set(w.reason || 'Other', (writeoffByReason.get(w.reason || 'Other') || 0) + amt)
    writeoffTotal += amt
  }

  const realGp = realRev - realCogs
  const roughGp = roughRev - roughCogs
  const knownRev = realRev + roughRev + serviceRev
  const grossProfit = realGp + roughGp + serviceRev
  const totalRev = knownRev + noCostRev

  return NextResponse.json({
    period: { from, to },
    entity: settings?.invoice_title || caller.vendor.name,
    tin: settings?.tax_id || null,
    vat: { isVatEntity, rate: vatRate },
    summary: {
      totalRevenue: r0(totalRev),
      knownRevenue: r0(knownRev),
      realRevenue: r0(realRev), realCogs: r0(realCogs), realProfit: r0(realGp),
      roughRevenue: r0(roughRev), roughCogs: r0(roughCogs), roughProfit: r0(roughGp),
      serviceRevenue: r0(serviceRev),
      noCostRevenue: r0(noCostRev), noCostQty,
      grossProfit: r0(grossProfit),
      grossMarginPct: knownRev > 0 ? Math.round((grossProfit / knownRev) * 100) : null,
      expenseTotal: r0(expenseTotal),
      writeoffTotal: r0(writeoffTotal),
      netProfit: r0(grossProfit - expenseTotal - writeoffTotal),
      // What share of the period's takings the profit figure cannot speak for
      coveragePct: totalRev > 0 ? Math.round((knownRev / totalRev) * 100) : null,
      saleCount: (sales || []).length,
      lineCount: detail.length,
    },
    detail,
    byProduct: [...productAgg.values()].sort((a, b) => b.profit - a.profit),
    noCost: [...noCostAgg.values()].sort((a, b) => b.revenue - a.revenue),
    expenses: [...expenseByCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    writeoffs: [...writeoffByReason.entries()].map(([reason, amount]) => ({ reason, amount })).sort((a, b) => b.amount - a.amount),
    writeoffList: (writeoffRows || []).map((w: any) => ({
      no: w.writeoff_no, date: String(w.writeoff_date).slice(0, 10),
      reason: w.reason, cost: r0(w.total_cost),
    })),
  })
}
