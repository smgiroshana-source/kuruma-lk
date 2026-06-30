import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'

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

// Returns ISO string for start of day in LK time (UTC+5:30)
function lkStartOfDay(dateStr: string): string {
  return `${dateStr}T00:00:00+05:30`
}

// Returns ISO string for end of day in LK time (UTC+5:30)
function lkEndOfDay(dateStr: string): string {
  return `${dateStr}T23:59:59+05:30`
}

// Returns today's date as YYYY-MM-DD in LK time
function lkTodayStr(): string {
  const now = new Date()
  // Offset from UTC by +330 minutes
  const lkOffset = 330 * 60 * 1000
  const lkNow = new Date(now.getTime() + lkOffset)
  return lkNow.toISOString().slice(0, 10)
}

// Returns the Monday of the current week as YYYY-MM-DD in LK time
function lkMondayStr(): string {
  const now = new Date()
  const lkOffset = 330 * 60 * 1000
  const lkNow = new Date(now.getTime() + lkOffset)
  const day = lkNow.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(lkNow)
  monday.setUTCDate(lkNow.getUTCDate() + diffToMonday)
  return monday.toISOString().slice(0, 10)
}

// Returns the first day of current month as YYYY-MM-DD in LK time
function lkFirstOfMonthStr(): string {
  const now = new Date()
  const lkOffset = 330 * 60 * 1000
  const lkNow = new Date(now.getTime() + lkOffset)
  const y = lkNow.getUTCFullYear()
  const m = String(lkNow.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

function formatPeriodLabel(period: string, fromStr: string, toStr: string): string {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (period === 'today') {
    const d = new Date(lkStartOfDay(fromStr))
    return `Today, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  }
  if (period === 'week') {
    return `This week (from ${fromStr})`
  }
  if (period === 'month') {
    const d = new Date(lkStartOfDay(fromStr))
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  }
  return `${fromStr} to ${toStr}`
}

export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = auth

  const admin = createAdminClient()
  const url = new URL(req.url)
  const type = url.searchParams.get('type')

  // ── Reorder suggestions ────────────────────────────────────────────────────
  if (type === 'reorder') {
    const { data: reorderProducts, error: reorderError } = await admin
      .from('products')
      .select('id, sku, name, quantity, min_stock_level, cost, category, product_type')
      .eq('vendor_id', vendor.id)
      .eq('is_active', true)
      .gt('min_stock_level', 0)

    if (reorderError) return NextResponse.json({ error: reorderError.message }, { status: 500 })

    // Filter in JS: quantity <= min_stock_level
    const belowMin = (reorderProducts || []).filter(
      (p: any) => parseInt(p.quantity ?? 0) <= parseInt(p.min_stock_level ?? 0)
    )

    // Fetch 30-day sales volume from stock_movements
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: movements } = await admin
      .from('stock_movements')
      .select('product_id, quantity_change')
      .eq('vendor_id', vendor.id)
      .eq('movement_type', 'sale')
      .gte('created_at', thirtyDaysAgo)

    // Aggregate sold_30d per product
    const sold30Map: Record<string, number> = {}
    for (const m of (movements || [])) {
      const pid = m.product_id
      if (!pid) continue
      sold30Map[pid] = (sold30Map[pid] || 0) + Math.abs(parseInt(m.quantity_change ?? 0))
    }

    // Build result rows
    const resultProducts = belowMin.map((p: any) => {
      const qty = parseInt(p.quantity ?? 0)
      const minLevel = parseInt(p.min_stock_level ?? 0)
      const sold30d = sold30Map[p.id] || 0
      const deficit = minLevel - qty

      // Suggested quantity: 2× min or 30-day sales (whichever higher), at least enough to cover deficit
      const baseQty = sold30d > 0
        ? Math.max(minLevel * 2, sold30d)
        : minLevel * 2
      const rawSuggested = Math.max(baseQty, deficit)
      // Round up to nearest 5
      const suggested_qty = Math.ceil(rawSuggested / 5) * 5

      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        quantity: qty,
        min_stock_level: minLevel,
        cost: parseInt(p.cost ?? 0),
        category: p.category,
        product_type: p.product_type,
        deficit,
        sold_30d: sold30d,
        suggested_qty,
      }
    }).sort((a: any, b: any) => b.deficit - a.deficit)

    return NextResponse.json({ products: resultProducts })
  }

  // ── Gross Profit report ────────────────────────────────────────────────────
  if (type === 'gp') {
    const period = url.searchParams.get('period') || 'today'
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')

    const todayStr = lkTodayStr()

    let rangeFromStr: string
    let rangeToStr: string

    if (period === 'today') {
      rangeFromStr = todayStr
      rangeToStr = todayStr
    } else if (period === 'week') {
      rangeFromStr = lkMondayStr()
      rangeToStr = todayStr
    } else if (period === 'month') {
      rangeFromStr = lkFirstOfMonthStr()
      rangeToStr = todayStr
    } else {
      // custom
      rangeFromStr = fromParam || todayStr
      rangeToStr = toParam || todayStr
    }

    const rangeStart = lkStartOfDay(rangeFromStr)
    const rangeEnd = lkEndOfDay(rangeToStr)

    // Step 1: Fetch non-voided sales in range (paginated — a busy period can
    // exceed the 1000-row cap, which would silently understate the totals)
    let saleList: any[]
    try {
      saleList = await fetchAllRows((from, to) => admin
        .from('sales')
        .select('id, total, payment_method, created_at')
        .eq('vendor_id', vendor.id)
        .is('voided_at', null)
        .gte('created_at', rangeStart)
        .lte('created_at', rangeEnd)
        .order('id')
        .range(from, to))
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to load sales' }, { status: 500 })
    }

    let revenue = 0
    let cogs = 0

    if (saleList.length > 0) {
      const saleIds = saleList.map((s: any) => s.id)

      // Step 2: Fetch sale_items for those sales (chunked over the id list and
      // paginated — the combined line items easily exceed 1000, which would
      // undercount COGS and overstate gross profit)
      const saleItems = await fetchAllByIds(saleIds, (ids, from, to) => admin
        .from('sale_items')
        .select('sale_id, product_id, quantity, unit_price, unit_cost')
        .in('sale_id', ids)
        .order('id')
        .range(from, to))

      for (const si of (saleItems || [])) {
        const qty = parseInt(si.quantity ?? 0)
        const price = parseInt(si.unit_price ?? 0)
        const cost = parseInt(si.unit_cost ?? 0)
        revenue += qty * price
        cogs += qty * cost
      }
    }

    const gross_profit = revenue - cogs
    const sale_count = saleList.length
    const avg_sale = sale_count > 0 ? Math.round(revenue / sale_count) : 0
    const gp_percent = revenue > 0 ? Math.round((gross_profit / revenue) * 100 * 10) / 10 : 0

    // Payment method breakdown from sales rows
    let cash_revenue = 0
    let card_revenue = 0
    let bank_revenue = 0
    let cheque_revenue = 0

    for (const s of saleList) {
      const total = parseInt(s.total ?? 0)
      const method = (s.payment_method || 'cash').toLowerCase()
      if (method === 'cash') cash_revenue += total
      else if (method === 'card') card_revenue += total
      else if (method === 'bank' || method === 'bank_transfer') bank_revenue += total
      else if (method === 'cheque') cheque_revenue += total
      // credit / advance / settlement — not counted in method breakdown
    }

    const period_label = formatPeriodLabel(period, rangeFromStr, rangeToStr)

    return NextResponse.json({
      revenue,
      cogs,
      gross_profit,
      gp_percent,
      sale_count,
      avg_sale,
      cash_revenue,
      card_revenue,
      bank_revenue,
      cheque_revenue,
      period_label,
      range_start: rangeStart,
      range_end: rangeEnd,
    })
  }

  // ── Stock value ────────────────────────────────────────────────────────────
  if (type === 'stock_value') {
    // Summary — paginated: a vendor with >1000 products would otherwise have its
    // stock valuation computed over only the first 1000 (badly undercounted).
    let rows: any[]
    try {
      rows = await fetchAllRows((from, to) => admin
        .from('products')
        .select('quantity, cost, price')
        .eq('vendor_id', vendor.id)
        .eq('is_active', true)
        .order('id')
        .range(from, to))
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to load products' }, { status: 500 })
    }
    let total_products = rows.length
    let total_units = 0
    let total_cost_value = 0
    let total_retail_value = 0

    for (const p of rows) {
      const qty = parseInt(p.quantity ?? 0)
      const cost = parseInt(p.cost ?? 0)
      const price = parseInt(p.price ?? 0)
      total_units += qty
      total_cost_value += qty * cost
      total_retail_value += qty * price
    }

    const potential_gp = total_retail_value - total_cost_value
    const potential_gp_percent = total_retail_value > 0
      ? Math.round((potential_gp / total_retail_value) * 100 * 10) / 10
      : 0

    // Top 5 categories by cost value (only products with stock > 0) — paginated
    let catRows: any[]
    try {
      catRows = await fetchAllRows((from, to) => admin
        .from('products')
        .select('category, quantity, cost')
        .eq('vendor_id', vendor.id)
        .eq('is_active', true)
        .gt('quantity', 0)
        .order('id')
        .range(from, to))
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Failed to load categories' }, { status: 500 })
    }

    // Aggregate by category in JS
    const catMap: Record<string, { category: string; cost_value: number; units: number }> = {}
    for (const p of (catRows || [])) {
      const cat = p.category || 'Uncategorized'
      if (!catMap[cat]) catMap[cat] = { category: cat, cost_value: 0, units: 0 }
      const qty = parseInt(p.quantity ?? 0)
      const cost = parseInt(p.cost ?? 0)
      catMap[cat].cost_value += qty * cost
      catMap[cat].units += qty
    }

    const top_categories = Object.values(catMap)
      .sort((a, b) => b.cost_value - a.cost_value)
      .slice(0, 5)

    return NextResponse.json({
      total_products,
      total_units,
      total_cost_value,
      total_retail_value,
      potential_gp,
      potential_gp_percent,
      top_categories,
    })
  }

  // ── Cash Flow (cash basis — actual money in/out, NOT sales totals) ───────────
  if (type === 'cashflow') {
    const fromStr = url.searchParams.get('from') || lkFirstOfMonthStr()
    const toStr   = url.searchParams.get('to')   || lkTodayStr()
    const rangeStart = lkStartOfDay(fromStr)
    const rangeEnd   = lkEndOfDay(toStr)
    // Only real external money methods count. Advance-applied and credit-return
    // rows are internal (no cash moved) and are excluded from both in and out.
    const MONEY = ['cash', 'card', 'cheque', 'bank']

    const [payments, expenses, supplierPays] = await Promise.all([
      fetchAllRows((f, t) => admin.from('payments')
        .select('amount, payment_method, created_at, sales:sale_id(invoice_no)')
        .eq('vendor_id', vendor.id).gte('created_at', rangeStart).lte('created_at', rangeEnd)
        .order('id').range(f, t)),
      fetchAllRows((f, t) => admin.from('expenses')
        .select('amount, category, description, payment_method, expense_date')
        .eq('vendor_id', vendor.id).gte('expense_date', fromStr).lte('expense_date', toStr)
        .order('id').range(f, t)),
      fetchAllRows((f, t) => admin.from('supplier_payments')
        .select('amount, method, payment_date, supplier:supplier_id(name)')
        .eq('vendor_id', vendor.id).gte('payment_date', fromStr).lte('payment_date', toStr)
        .order('id').range(f, t)),
    ])

    const inflowByMethod: Record<string, number> = { cash: 0, card: 0, cheque: 0, bank: 0 }
    const expensesByCategory: Record<string, number> = {}
    const ledger: any[] = []
    let refundsOut = 0, cashRefundsOut = 0

    for (const p of payments) {
      const amt = Math.round(Number(p.amount) || 0)
      const m = p.payment_method || 'cash'
      const inv = (p as any).sales?.invoice_no || ''
      if (!MONEY.includes(m)) continue            // advance-applied / credit_return → internal, skip
      if (amt > 0) { inflowByMethod[m] += amt; ledger.push({ date: p.created_at, type: 'Collection', ref: inv, method: m, in: amt, out: 0 }) }
      else if (amt < 0) { const out = -amt; refundsOut += out; if (m === 'cash') cashRefundsOut += out; ledger.push({ date: p.created_at, type: 'Refund', ref: inv, method: m, in: 0, out }) }
    }
    let expensesOut = 0, cashExpensesOut = 0
    for (const e of expenses) {
      const amt = Math.round(Number(e.amount) || 0)
      expensesOut += amt; expensesByCategory[e.category] = (expensesByCategory[e.category] || 0) + amt
      if ((e.payment_method || 'cash') === 'cash') cashExpensesOut += amt
      ledger.push({ date: e.expense_date, type: 'Expense', ref: e.category + (e.description ? ': ' + e.description : ''), method: e.payment_method || 'cash', in: 0, out: amt })
    }
    let supplierOut = 0, cashSupplierOut = 0
    for (const s of supplierPays) {
      const amt = Math.round(Number(s.amount) || 0)
      supplierOut += amt; if ((s.method || 'cash') === 'cash') cashSupplierOut += amt
      ledger.push({ date: s.payment_date, type: 'Supplier Payment', ref: (s as any).supplier?.name || '', method: s.method || 'cash', in: 0, out: amt })
    }

    const totalIn = inflowByMethod.cash + inflowByMethod.card + inflowByMethod.cheque + inflowByMethod.bank
    const totalOut = refundsOut + expensesOut + supplierOut
    const cashIn = inflowByMethod.cash
    const cashOut = cashRefundsOut + cashExpensesOut + cashSupplierOut

    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let run = 0
    for (const e of ledger) { run += e.in - e.out; e.balance = run }

    return NextResponse.json({
      from: fromStr, to: toStr,
      inflowByMethod, totalIn,
      expensesByCategory, expensesOut, supplierOut, refundsOut, totalOut,
      net: totalIn - totalOut,
      cashDrawer: { in: cashIn, out: cashOut, net: cashIn - cashOut },
      ledger,
    })
  }

  return NextResponse.json({ error: 'Missing or unknown ?type= parameter. Use: reorder | gp | stock_value | cashflow' }, { status: 400 })
}
