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
    .select('sku, cost, cost_is_estimate, product_type, category').eq('vendor_id', caller.vendor.id)
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

  // ── Revenue and profit by what was actually sold ──────────────────────────
  //
  // The owner wanted spare parts separated from the rest. Nothing new has to be
  // entered for it: every line already carries its product, and every product
  // its type and category. A separate invoice series would have meant a third
  // gapless gazette sequence to maintain forever, and two invoices for the
  // customer who buys a tyre and pays for fitting on the same visit.
  //
  // product_type alone is not enough — 'part' holds both the tubes and flaps
  // (Wheels & Tires) and the body panels and lamps, which are different trades.
  // Category separates them.
  const groupOf = (sku: string | null, prod: any): string => {
    if (!sku) return 'Services & labour'
    if (!prod) return 'Unknown product'
    if (prod.product_type === 'tyre') return 'Tyres'
    if (prod.product_type === 'consumable') return 'Consumables'
    if (prod.category === 'Wheels & Tires') return 'Tubes & flaps'
    return 'Spare parts'
  }
  type Group = { group: string; lines: number; qty: number; revenue: number; cost: number; profit: number; noCostLines: number; noCostRevenue: number }
  const groupAgg = new Map<string, Group>()

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

      // Same buckets the totals use: a line with no cost contributes revenue but
      // no profit, and says so, rather than inventing margin from a missing cost.
      const gName = groupOf(i.product_sku || null, prod)
      const g = groupAgg.get(gName) || { group: gName, lines: 0, qty: 0, revenue: 0, cost: 0, profit: 0, noCostLines: 0, noCostRevenue: 0 }
      g.lines++; g.qty += qty; g.revenue += revenue
      if (basis === 'none') { g.noCostLines++; g.noCostRevenue += revenue }
      else { g.cost += r0(cost); g.profit += r0(revenue - cost) }
      groupAgg.set(gName, g)

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

  // Credit notes received from suppliers — settlement and quantity discounts,
  // price adjustments. Owner decision 2026-08-22: shown as income of the
  // period rather than reducing what the goods cost, so the margin on invoices
  // already issued and printed is never re-stated.
  //
  // NET only. The VAT on the note is recovered through the VAT return, not
  // kept — counting it here would inflate profit by money owed to IRD.
  const { data: supCredits } = await admin.from('supplier_credit_notes')
    .select('credit_note_no, credit_note_date, reason, net_amount, supplier:suppliers(name)')
    .eq('vendor_id', caller.vendor.id)
    .gte('credit_note_date', from).lte('credit_note_date', to)
    .order('credit_note_date')
  const supplierCreditTotal = (supCredits || []).reduce((t: number, c: any) => t + r0(c.net_amount), 0)

  // ── Salary on the accrual basis ──────────────────────────────────────────
  // Salary is paid ~the 25th for the 25th→24th cycle, so a window that ends
  // before payday carries almost no salary cost and profit reads a full
  // payroll better than it is. Owner, 2026-09-06: the cost is knowable —
  // daily-paid staff have a rate and attendance; monthly staff cost
  // (monthly pay ÷ 25 working days) × days worked in the window. Charge that,
  // and treat salary cash that went out inside the window (advances, a
  // payroll run) as the same cost paid early, not a second cost.
  const salaryPaidInWindow = r0(expenseByCat.get('salaries') || 0)
  const WORKING_DAYS_PER_MONTH = 25
  const calendarDays = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1)
  let salaryAccrual = 0
  let salaryBasis: 'attendance' | 'estimated' | 'none' = 'none'
  const salaryLines: { name: string; payType: string; daysWorked: number; amount: number }[] = []
  {
    const { data: emps } = await admin.from('employees')
      .select('id, name, pay_type').eq('vendor_id', caller.vendor.id).eq('active', true)
    const ids = (emps || []).map((e: any) => e.id)
    const { data: items } = ids.length
      ? await admin.from('employee_pay_items').select('employee_id, kind, unit, period, amount, half_day_policy')
          .in('employee_id', ids).eq('active', true).eq('unit', 'rs').in('kind', ['base', 'allowance', 'other'])
      : { data: [] as any[] }
    const { data: att } = ids.length
      ? await admin.from('staff_attendance').select('employee_id, status')
          .in('employee_id', ids).gte('date', from).lte('date', to)
      : { data: [] as any[] }
    const anyAttendance = (att || []).length > 0
    // No attendance marked at all in the window (an old period, or a shop not
    // using the register): assume the calendar days at 25/30, and say so.
    const fallbackDays = Math.round(calendarDays * WORKING_DAYS_PER_MONTH / 30 * 2) / 2
    for (const e of (emps || [])) {
      const mine = (att || []).filter((a: any) => a.employee_id === e.id)
      const present = anyAttendance ? mine.filter((a: any) => a.status === 'present').length : fallbackDays
      const half = anyAttendance ? mine.filter((a: any) => a.status === 'half').length : 0
      let amount = 0
      for (const it of (items || []).filter((i: any) => i.employee_id === e.id)) {
        const perDay = it.period === 'monthly' ? Number(it.amount) / WORKING_DAYS_PER_MONTH
                     : it.period === 'daily' ? Number(it.amount) : 0
        const halfFactor = it.half_day_policy === 'none' ? 0 : it.half_day_policy === 'full' ? 1 : 0.5
        amount += perDay * (present + halfFactor * half)
      }
      const daysWorked = present + 0.5 * half
      if (amount > 0 || daysWorked > 0) salaryLines.push({ name: e.name, payType: e.pay_type, daysWorked, amount: r0(amount) })
      salaryAccrual += amount
    }
    salaryAccrual = r0(salaryAccrual)
    if (salaryAccrual > 0) salaryBasis = anyAttendance ? 'attendance' : 'estimated'
  }
  const expenseExclSalary = r0(expenseTotal - salaryPaidInWindow)

  const realGp = realRev - realCogs
  const roughGp = roughRev - roughCogs
  const knownRev = realRev + roughRev + serviceRev
  const grossProfit = realGp + roughGp + serviceRev
  const totalRev = knownRev + noCostRev

  // Biggest earner first — the question is always which line of trade pays.
  const groups = [...groupAgg.values()]
    .map(g => ({ ...g, revenue: r0(g.revenue), cost: r0(g.cost), profit: r0(g.profit),
                 noCostRevenue: r0(g.noCostRevenue),
                 marginPct: (g.revenue - g.noCostRevenue) > 0
                   ? Math.round((g.profit / (g.revenue - g.noCostRevenue)) * 100) : null,
                 shareOfRevenuePct: totalRev > 0 ? Math.round((g.revenue / totalRev) * 100) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({
    period: { from, to },
    groups,
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
      supplierCreditTotal: r0(supplierCreditTotal),
      expenseExclSalary,
      salaryAccrual,
      salaryPaidInWindow,
      // Accrual basis: salary for the days worked in the window, whether or
      // not payday fell inside it. Cash salary paid inside the window is that
      // same cost, so it is not charged a second time.
      netProfit: r0(grossProfit - expenseExclSalary - salaryAccrual - writeoffTotal + supplierCreditTotal),
      // What share of the period's takings the profit figure cannot speak for
      coveragePct: totalRev > 0 ? Math.round((knownRev / totalRev) * 100) : null,
      saleCount: (sales || []).length,
      lineCount: detail.length,
    },
    salary: {
      accrual: salaryAccrual, paidInWindow: salaryPaidInWindow, basis: salaryBasis,
      workingDaysPerMonth: WORKING_DAYS_PER_MONTH, calendarDays,
      staffCount: salaryLines.length,
      daysWorked: salaryLines.reduce((t, l) => t + l.daysWorked, 0),
      // Individual pay is the owner's to see; a manager gets the total only.
      lines: caller.role === 'owner' ? salaryLines.sort((x, y) => y.amount - x.amount) : [],
    },
    detail,
    byProduct: [...productAgg.values()].sort((a, b) => b.profit - a.profit),
    noCost: [...noCostAgg.values()].sort((a, b) => b.revenue - a.revenue),
    expenses: [...expenseByCat.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount),
    writeoffs: [...writeoffByReason.entries()].map(([reason, amount]) => ({ reason, amount })).sort((a, b) => b.amount - a.amount),
    supplierCredits: (supCredits || []).map((c: any) => ({
      no: c.credit_note_no, date: String(c.credit_note_date).slice(0, 10),
      supplier: c.supplier?.name || '', reason: c.reason, amount: r0(c.net_amount),
    })),
    writeoffList: (writeoffRows || []).map((w: any) => ({
      no: w.writeoff_no, date: String(w.writeoff_date).slice(0, 10),
      reason: w.reason, cost: r0(w.total_cost),
    })),
  })
}
