import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { colomboDayOf } from '@/lib/dates'
import { checkPromotable, checkReversible, mayReversePromotion, PROMOTE_WINDOW_DAYS } from '@/lib/promoteReceipt'
import { adjustProductQuantity } from '@/lib/stock'
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'
import { branchEntityIds, resolveBranch, applyBranchFilter, applyBranchFilterOnSales } from '@/lib/branchScope'
import { linkSaleToClaim } from '@/lib/claims'
import { recordSellThrough, voidSellThrough, returnSellThrough } from '@/lib/sellThrough'
import { creditOnAccountProblem } from '@/lib/creditOnAccount'
import { resolveAdvanceSource } from '@/lib/advanceSource'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  // branchScope and the caller's own id ride on the vendor object so existing
  // callers keep working; the audit log and the reversal permission need to
  // know WHO is acting, not just which shop.
  if (vendor) return { ...vendor, branchScope: 'both', callerUserId: user.id }
  // Check if staff member
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { ...staffLink.vendor, branchScope: staffLink.branch_scope || 'shop', callerUserId: user.id }
  return null
}

async function generateInvoiceNo(vendorId: string, vendorName: string) {
  const admin = createAdminClient()
  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')

  // Atomic counter (supabase-wheelmart-phase9.sql) — read-max-then-insert
  // can mint duplicate numbers under two concurrent sales.
  const { data: seq, error: seqError } = await admin.rpc('next_vendor_seq', {
    p_vendor_id: vendorId,
    p_series: 'regular',
  })
  if (!seqError && seq != null) return `${prefix}-${String(seq).padStart(5, '0')}`

  // Fallback until the migration runs: single highest regular invoice
  // (zero-padded numbers sort correctly lexicographically). Excludes
  // On Approval drafts (-OP-) so the two sequences never interfere.
  const { data } = await admin
    .from('sales')
    .select('invoice_no')
    .eq('vendor_id', vendorId)
    .not('invoice_no', 'ilike', '%-OP-%')
    .not('invoice_no', 'ilike', 'DRAFT-%')
    .order('invoice_no', { ascending: false })
    .limit(1)

  let maxNum = 0
  if (data && data[0]) {
    const match = (data[0].invoice_no || '').match(/-(\d+)$/)
    if (match) maxNum = parseInt(match[1])
  }

  return `${prefix}-${String(maxNum + 1).padStart(5, '0')}`
}

async function generateDraftNo(vendorId: string, vendorName: string) {
  const admin = createAdminClient()
  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')

  // Atomic counter (supabase-wheelmart-phase9.sql)
  const { data: seq, error: seqError } = await admin.rpc('next_vendor_seq', {
    p_vendor_id: vendorId,
    p_series: 'op',
  })
  if (!seqError && seq != null) return `${prefix}-OP-${String(seq).padStart(4, '0')}`

  // Fallback until the migration runs: single highest On Approval number.
  const { data } = await admin
    .from('sales')
    .select('invoice_no')
    .eq('vendor_id', vendorId)
    .ilike('invoice_no', '%-OP-%')
    .order('invoice_no', { ascending: false })
    .limit(1)

  let maxNum = 0
  if (data && data[0]) {
    const match = (data[0].invoice_no || '').match(/-OP-(\d+)$/)
    if (match) maxNum = parseInt(match[1])
  }

  return `${prefix}-OP-${String(maxNum + 1).padStart(4, '0')}`
}

// ── lk_tax helpers ────────────────────────────────────────────────────────────

/** Returns the vendor_settings.invoice_mode for this vendor. */
async function getInvoiceMode(vendorId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('vendor_settings')
    .select('invoice_mode')
    .eq('vendor_id', vendorId)
    .single()
  return data?.invoice_mode || 'simple'
}

/** Fetches a single invoice entity row. */
async function getInvoiceEntity(entityId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('invoice_entities')
    .select('id, name, address, tin, vat_registered, invoice_mode, serial_qqqq, receipt_prefix')
    .eq('id', entityId)
    .single()
  return data
}

/** Fetches VAT rate from tax_config (default 18 if not found). */
async function getVatRate(vendorId: string): Promise<number> {
  // Effective-dated: a scheduled rate change takes effect on its date without
  // anyone editing config on the day. Falls back to flat tax_config.
  const admin = createAdminClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const { data: hist } = await admin.from('tax_rate_history')
    .select('value, effective_from')
    .eq('vendor_id', vendorId).eq('key', 'vat_rate')
    .lte('effective_from', today)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  if (hist) return parseFloat(hist.value)
  const { data } = await admin
    .from('tax_config')
    .select('value')
    .eq('vendor_id', vendorId)
    .eq('key', 'vat_rate')
    .single()
  return data ? parseFloat(data.value) : 18
}

/**
 * Atomically reserves the next serial number via the Postgres RPC and
 * formats it as either a gazette serial (YYMMM_QQQQ_XXXXX) or a receipt
 * number (PREFIX-XXXXX).
 *
 * @param entityId  invoice_entities.id
 * @param entity    the entity row (needs receipt_prefix, serial_qqqq)
 * @param docType   'receipt' | 'tax_invoice'
 * @param supplyDate  used to derive YYMMM period for gazette serials
 */
async function reserveSerial(
  entityId: string,
  entity: { receipt_prefix: string; serial_qqqq: string },
  docType: 'receipt' | 'tax_invoice',
  supplyDate: Date
): Promise<{ invoiceNo: string; receiptNo: string | null; taxSerial: string | null }> {
  const admin = createAdminClient()

  let period: string
  let format: (n: number) => string

  if (docType === 'tax_invoice') {
    const yy = supplyDate.getFullYear().toString().slice(-2)
    const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
    const mmm = MONTHS[supplyDate.getMonth()]
    period = `${yy}${mmm}` // e.g. '26JUN'
    format = (n: number) => `${period}_${entity.serial_qqqq}_${String(n).padStart(5, '0')}`
  } else {
    period = 'receipt'
    format = (n: number) => `${entity.receipt_prefix}-${String(n).padStart(5, '0')}`
  }

  const { data: nextNum, error } = await admin.rpc('next_invoice_serial', {
    p_entity_id: entityId,
    p_period: period,
  })

  if (error || nextNum == null) {
    throw new Error('Serial generation failed: ' + (error?.message ?? 'null result'))
  }

  const serialNo = format(nextNum as number)
  return {
    invoiceNo: serialNo,
    receiptNo: docType === 'receipt' ? serialNo : null,
    taxSerial: docType === 'tax_invoice' ? serialNo : null,
  }
}

/**
 * Hand a freshly minted serial back to the counter.
 *
 * Only safe while ours is still the highest number issued — if anyone has
 * reserved since, decrementing would hand the same number out twice. The
 * conditional update makes that check and the write atomic; a false return
 * means the number is spent and the caller must account for it another way
 * (create_sale writes a VOID row carrying it, which keeps the ledger gapless).
 */
async function releaseSerial(entityId: string, period: string, number: number): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin.from('invoice_sequences')
    .update({ last_number: number - 1 })
    .eq('entity_id', entityId).eq('period', period).eq('last_number', number)
    .select('entity_id')
  return !!data && data.length > 0
}

export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || 'all'
  const saleId = url.searchParams.get('id')

  // May THIS person withdraw tax invoices at all? Answered from the role
  // alone — the button's visibility must not hinge on the log table, or a
  // missing migration silently hides a feature instead of failing where the
  // problem actually is.
  if (url.searchParams.get('action') === 'reverse_permission') {
    const perm = await mayReversePromotion(admin, vendor, (vendor as any).callerUserId)
    return NextResponse.json({ allowed: perm.allowed, role: perm.role })
  }

  // Can this tax invoice be un-promoted, and may THIS person do it?
  if (url.searchParams.get('action') === 'reverse_check' && saleId) {
    const perm = await mayReversePromotion(admin, vendor, (vendor as any).callerUserId)
    if (!perm.allowed) {
      return NextResponse.json({
        eligible: false,
        reason: 'Reversing a tax invoice is limited to the owner and managers authorised for both stores.',
        allowed: false,
      })
    }
    const check = await checkReversible(admin, vendor.id, saleId)
    return NextResponse.json({ ...check, allowed: true, actorRole: perm.role })
  }

  // The promotion history. Same gate as the action itself — if you may not
  // reverse, you may not read who did.
  if (url.searchParams.get('action') === 'promotion_log') {
    const perm = await mayReversePromotion(admin, vendor, (vendor as any).callerUserId)
    if (!perm.allowed) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    const { data, error } = await admin.from('invoice_promotion_log')
      .select('*').eq('vendor_id', vendor.id).order('created_at', { ascending: false }).limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ log: data || [], allowed: true })
  }

  // Pre-flight: can this receipt be promoted, and what will it disturb?
  // Answered before the operator commits, so the numbering consequences are a
  // decision rather than a discovery.
  if (url.searchParams.get('action') === 'promote_check' && saleId) {
    const check = await checkPromotable(admin, vendor.id, saleId)
    return NextResponse.json({ ...check, windowDays: PROMOTE_WINDOW_DAYS })
  }

  if (saleId) {
    const { data: sale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*), customer:customers(id, name, phone, whatsapp)')
      .eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ sale, vendor })
  }

  // Customer purchase history
  // "What did this vehicle read last time?" — shown at the POS while the
  // cashier types, so the interval since the last alignment is visible.
  const mileageFor = url.searchParams.get('last_mileage_vehicle')
  if (mileageFor?.trim()) {
    const { data: last } = await admin.from('sales')
      .select('mileage_km, created_at, invoice_no, tax_serial, receipt_no')
      .eq('vendor_id', vendor.id)
      .ilike('vehicle_no', mileageFor.trim())
      .not('mileage_km', 'is', null)
      .neq('payment_status', 'voided')
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    return NextResponse.json({ last: last || null })
  }

  const customerId = url.searchParams.get('customer_id')
  if (customerId) {
    const { data: custSales } = await admin
      .from('sales')
      .select('*, items:sale_items(id, product_id, product_name, product_sku, quantity, unit_price, total, returned_quantity), payments:payments(id, amount, payment_method, source_method, cheque_number, created_at)')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .neq('payment_status', 'voided')
      .neq('payment_status', 'draft')
      .order('invoice_no', { ascending: true })
    const { data: cust } = await admin.from('customers').select('*').eq('id', customerId).single()
    return NextResponse.json({ sales: custSales || [], customer: cust, vendor })
  }

  // Support explicit from/to date range
  const fromDate = url.searchParams.get('from')
  const toDate = url.searchParams.get('to')
  const branch = resolveBranch((vendor as any).branchScope, url.searchParams.get('branch'))
  const branchIds = branch ? await branchEntityIds(vendor.id, branch) : []

  let dateFilter: string | null = null
  const now = new Date()
  if (!fromDate) {
    // Colombo day boundaries (+05:30), not the server's zone — on Vercel that
    // is UTC, so "today" used to start at 5:30am Colombo.
    const colomboDay = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    if (period === 'today') { dateFilter = new Date(`${colomboDay}T00:00:00+05:30`).toISOString() }
    else if (period === 'week') { const d = new Date(`${colomboDay}T00:00:00+05:30`); d.setDate(d.getDate() - 7); dateFilter = d.toISOString() }
    else if (period === 'month') { const d = new Date(`${colomboDay}T00:00:00+05:30`); d.setMonth(d.getMonth() - 1); dateFilter = d.toISOString() }
  }

  // Paginate the full result set. The dashboard sums these into all-time
  // revenue / paid / credit / top-products / top-customers; a flat .limit() (or
  // the PostgREST 1000 cap) silently understated those totals for high-volume
  // vendors. created_at is non-unique, so id is the stable tiebreaker.
  const allSales = await fetchAllRows((from, to) => {
    let query = admin
      .from('sales')
      .select('*, items:sale_items(id, product_id, product_name, product_sku, quantity, unit_price, unit_cost, total, returned_quantity), customer:customers(id, name, phone), payments:payments(id, amount, payment_method, source_method)')
      .eq('vendor_id', vendor.id)
    // Branch view: shop (PART/PROP) vs workshop (REPR/WPRO). A scoped login is
    // pinned to its own side; owners choose with ?branch=
    query = applyBranchFilter(query, branch, branchIds)
    if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString())
    if (toDate) { const end = new Date(toDate); end.setDate(end.getDate() + 1); query = query.lt('created_at', end.toISOString()) }
    if (!fromDate && dateFilter) query = query.gte('created_at', dateFilter)
    return query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)
  })
  const activeSales = allSales.filter((s: any) => s.payment_status !== 'voided' && s.payment_status !== 'draft')
  // Exclude opening balance entries from sales stats (they're past transaction records, not actual sales)
  const isOpeningBalance = (s: any) => (s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
  const realSales = activeSales.filter((s: any) => !isOpeningBalance(s))
  const totalRevenue = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.total || 0), 0)
  const totalPaid = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.paid_amount || 0), 0)
  const totalCredit = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.balance_due || 0), 0)
  const totalSales = realSales.length
  const totalItems = realSales.reduce((sum: number, s: any) => sum + (s.items?.reduce((is: number, i: any) => is + i.quantity, 0) || 0), 0)
  const totalDiscount = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.discount || 0), 0)

  // Top selling products
  const productMap: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {}
  realSales.forEach((s: any) => {
    (s.items || []).forEach((i: any) => {
      if (i.product_sku === 'OPENING-BAL') return
      // Net of returns. A full return no longer voids the sale — it stays, with
      // returned_quantity on the line and returned_amount on the sale, so the
      // month it was sold in keeps its figure. Which means every sum over lines
      // must subtract what came back, or a spoiler sold and returned the same
      // day sits in Top Products as "1 sold, Rs.10,000".
      const netQty = Number(i.quantity) - Number(i.returned_quantity || 0)
      if (netQty <= 0) return
      const key = i.product_sku || i.product_name
      if (!productMap[key]) productMap[key] = { name: i.product_name, sku: i.product_sku || '', qty: 0, revenue: 0 }
      productMap[key].qty += netQty
      productMap[key].revenue += netQty * parseFloat(i.unit_price || 0)
    })
  })
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  // Payment method breakdown
  const methodMap: Record<string, number> = {}
  activeSales.forEach((s: any) => {
    if (s.payments && s.payments.length > 0) {
      s.payments.forEach((p: any) => {
        const method = p.payment_method || 'cash'
        methodMap[method] = (methodMap[method] || 0) + parseFloat(p.amount || 0)
      })
    } else {
      const method = s.payment_method || 'cash'
      methodMap[method] = (methodMap[method] || 0) + parseFloat(s.paid_amount || 0)
    }
    if (parseFloat(s.balance_due || 0) > 0) {
      methodMap['credit'] = (methodMap['credit'] || 0) + parseFloat(s.balance_due || 0)
    }
  })
  const paymentBreakdown = Object.entries(methodMap).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount)

  // Daily revenue (for chart) — last 30 days
  const dailyMap: Record<string, { date: string; revenue: number; count: number; paid: number }> = {}
  activeSales.forEach((s: any) => {
    const d = new Date(s.created_at).toISOString().slice(0, 10)
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, count: 0, paid: 0 }
    dailyMap[d].revenue += parseFloat(s.total || 0)
    dailyMap[d].count += 1
    dailyMap[d].paid += parseFloat(s.paid_amount || 0)
  })
  const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)

  // Top customers
  const customerMap: Record<string, { name: string; phone: string; id: string; spent: number; count: number }> = {}
  activeSales.forEach((s: any) => {
    const name = s.customer?.name || s.customer_name || 'Walk-in'
    const id = s.customer_id || 'walkin'
    if (!customerMap[id]) customerMap[id] = { name, phone: s.customer?.phone || s.customer_phone || '', id, spent: 0, count: 0 }
    // Net of what they sent back — a ranking of who spends should not credit a
    // customer with Rs.15,000 they returned in full the same afternoon.
    customerMap[id].spent += parseFloat(s.total || 0) - parseFloat(s.returned_amount || 0)
    customerMap[id].count += 1
  })
  const topCustomers = Object.values(customerMap).sort((a, b) => b.spent - a.spent)

  // Fetch credit collections received in this period (payments on older invoices)
  let collectionsToday: any[] = []
  // Advance applied to an old invoice today. Not new money — the customer paid
  // it earlier, or it was just credited back on a return — so it stays out of
  // the cash figures. But dropping it entirely left a hole in the story: the
  // 4 Sep report showed a Rs.80,000 "refund" on SAK-00819 and no trace of the
  // Rs.80,000 that settled SAK-00039 a minute later. Same rupees, two rows.
  let advanceOffsets: any[] = []
  const periodStart = fromDate ? new Date(fromDate).toISOString() : dateFilter
  const periodEnd = toDate ? (() => { const e = new Date(toDate); e.setDate(e.getDate() + 1); return e.toISOString() })() : null
  {
    // "All" has no periodStart, and the whole block used to be skipped for it —
    // so the All filter reported Rs.0 collections and Rs.0 returns while Month
    // showed Rs.17.7m and Rs.430k. Zero read as "none happened", when it only
    // meant "not looked for". No lower bound is the correct query for All, not
    // a reason to skip.
    // A FRESH builder per page: supabase query builders are mutable, so reusing
    // one across pages stacks .order() params and re-awaits a spent builder.
    const buildPayments = () => {
      let q = admin
        .from('payments')
        // notes carries what came back ("RETURN: <item> x1") — the only record
        // of WHICH item a return was for, so the tile can name it.
        .select('id, amount, payment_method, cheque_number, notes, created_by, created_at, sale_id, sales!inner(id, invoice_no, customer_name, customer_id, vendor_id, created_at, payment_status, customer:customers(name, phone), items:sale_items(product_sku))')
        .eq('sales.vendor_id', vendor.id)
      if (periodStart) q = q.gte('created_at', periodStart)
      // Collections belong to the branch of the invoice they settle
      q = applyBranchFilterOnSales(q, branch, branchIds)
      if (periodEnd) q = q.lt('created_at', periodEnd)
      return q
    }
    // Was .limit(500). Over an unbounded All that truncates outright, and even a
    // busy month can exceed it — and a truncated total is a wrong total shown
    // without an error. id is the unique tiebreaker the paging needs.
    const periodPayments = await fetchAllRows((from, to) => buildPayments().order('created_at').order('id').range(from, to))
    // Filter to: payments on older invoices (credit collections) OR payments on Opening Balance invoices
    collectionsToday = (periodPayments || []).filter((p: any) => {
      const saleDate = p.sales?.created_at
      if (!saleDate) return false
      // Exclude POSITIVE advance payment records — these are internal offset entries, not new money received.
      // The actual cash/bank was already captured when the advance was originally deposited.
      // NEGATIVE advance payments are return refunds (e.g. battery returned → credit to advance) — keep those.
      if ((p.payment_method || '').toLowerCase() === 'advance' && parseFloat(p.amount || 0) > 0) return false // kept in advanceOffsets below
      // Check if this is an Opening Balance invoice
      const isOpeningBalance = (p.sales?.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
      if (isOpeningBalance) return true // Opening balance payments always count as collections
      // A collection is money received on a LATER DAY than the sale — a fact
      // about the two events, not about the window they were fetched in.
      //
      // Comparing the sale against periodStart made the answer depend on the
      // caller: the Sales tab starts at Colombo midnight today and counted
      // yesterday's sale as a collection, while the daily report widens the
      // fetch to the previous UTC day (to catch early-morning Colombo sales)
      // and so swallowed the very same payment. Same money, two screens, two
      // answers. Colombo days settle it for both.
      return colomboDayOf(saleDate) < colomboDayOf(p.created_at)
    }).map((p: any) => ({
      id: p.id,
      amount: parseFloat(p.amount || 0),
      payment_method: p.payment_method,
      cheque_number: p.cheque_number,
      notes: p.notes || '',
      created_at: p.created_at,
      // the sale's own day, so a return raised against an older invoice is recognisable
      sale_created_at: p.sales?.created_at || null,
      created_by: p.created_by || null,
      sale_id: p.sale_id,
      invoice_no: p.sales?.invoice_no,
      customer_name: p.sales?.customer?.name || p.sales?.customer_name || 'Unknown',
      sale_voided: p.sales?.payment_status === 'voided',
    }))
    advanceOffsets = (periodPayments || [])
      .filter((p: any) => (p.payment_method || '').toLowerCase() === 'advance' && parseFloat(p.amount || 0) > 0 && p.sales?.payment_status !== 'voided')
      .map((p: any) => ({
        id: p.id, amount: parseFloat(p.amount || 0), created_at: p.created_at, sale_id: p.sale_id,
        invoice_no: p.sales?.invoice_no, customer_name: p.sales?.customer?.name || p.sales?.customer_name || 'Unknown',
        sale_created_at: p.sales?.created_at || null, notes: p.notes || '',
      }))
  }

  // Separate positive collections from negative (returns/refunds)
  const positiveCollections = collectionsToday.filter((c: any) => c.amount > 0)
  const returnsInPeriod = collectionsToday
    .filter((c: any) => c.amount < 0 && !c.sale_voided)
    .map((c: any) => ({ ...c, amount: Math.abs(c.amount) }))
  const totalCollections = positiveCollections.reduce((s: number, c: any) => s + c.amount, 0)
  const totalReturns = returnsInPeriod.reduce((s: number, c: any) => s + c.amount, 0)

  // Also check for returns made in this period on same-period invoices (not just older ones)
  // These show up as negative payments on same-day sales
  {
    const buildReturns = () => {
      let q = admin
        .from('payments')
        .select('id, amount, payment_method, notes, created_by, created_at, sale_id, sales!inner(id, invoice_no, customer_name, vendor_id, created_at, payment_status, customer:customers(name))')
        .eq('sales.vendor_id', vendor.id)
        .lt('amount', 0)
      if (periodStart) q = q.gte('created_at', periodStart)
      q = applyBranchFilterOnSales(q, branch, branchIds)
      if (periodEnd) q = q.lt('created_at', periodEnd)
      return q
    }
    // Was .limit(200) — same truncation risk as above, worse over All.
    const returnPayments = await fetchAllRows((from, to) => buildReturns().order('created_at').order('id').range(from, to))
    const existingIds = new Set(returnsInPeriod.map((r: any) => r.id))
    ;(returnPayments || [])
      .filter((p: any) => !existingIds.has(p.id) && p.sales?.payment_status !== 'voided')
      .forEach((p: any) => {
      returnsInPeriod.push({
        id: p.id, amount: Math.abs(parseFloat(p.amount || 0)),
        payment_method: p.payment_method, created_at: p.created_at, sale_id: p.sale_id,
        invoice_no: p.sales?.invoice_no, customer_name: p.sales?.customer?.name || p.sales?.customer_name || 'Unknown',
        notes: p.notes || '',
        sale_created_at: p.sales?.created_at || null, created_by: p.created_by || null,
      })
    })
  }
  const totalReturnsAll = returnsInPeriod.reduce((s: number, c: any) => s + c.amount, 0)

  // ── What actually came back, from the stock record rather than the note ──
  //
  // Until now a return could only be named by parsing its free-text note
  // ("RETURN: <item> x1"). sale_items.returned_quantity is the real record —
  // it is what stock was restored against — so read the goods from there and
  // report a piece count alongside the value.
  //
  // A return is dated by its payment, and sale_items carries no return date, so
  // the lines are attached per sale. One Sakura sale has two returns; attaching
  // its lines to both would count the same goods twice, so the lines go to the
  // most recent return of that sale and the earlier one keeps its note. Better
  // an honest gap on one row than a piece count that silently double-counts.
  let totalPiecesReturned = 0
  if (returnsInPeriod.length > 0) {
    const returnSaleIds = [...new Set(returnsInPeriod.map((r: any) => r.sale_id).filter(Boolean))]
    const returnedLines = await fetchAllByIds(returnSaleIds, (chunk, from, to) => admin
      .from('sale_items')
      .select('sale_id, product_name, product_sku, returned_quantity, unit_price')
      .in('sale_id', chunk).gt('returned_quantity', 0)
      .order('id').range(from, to))
    const linesBySale: Record<string, any[]> = {}
    for (const l of returnedLines) (linesBySale[l.sale_id] = linesBySale[l.sale_id] || []).push(l)

    // Newest return of each sale is the one that carries that sale's lines.
    const ownerOfSale: Record<string, string> = {}
    for (const r of returnsInPeriod) {
      const cur = ownerOfSale[r.sale_id]
      const curAt = cur ? returnsInPeriod.find((x: any) => x.id === cur)?.created_at : ''
      if (!cur || String(r.created_at || '') > String(curAt || '')) ownerOfSale[r.sale_id] = r.id
    }
    for (const r of returnsInPeriod) {
      const owns = ownerOfSale[r.sale_id] === r.id
      const lines = owns ? (linesBySale[r.sale_id] || []) : []
      r.returnedItems = lines.map((l: any) => ({
        name: l.product_name, sku: l.product_sku,
        quantity: Number(l.returned_quantity) || 0,
      }))
      r.pieces = r.returnedItems.reduce((s: number, i: any) => s + i.quantity, 0)
      totalPiecesReturned += r.pieces
    }
  }

  // ── Retroactive activity: anything done in this window that changes a day
  //    OTHER than the day it was done ────────────────────────────────────────
  //
  // Backdating is legitimate here — the counter's sales get entered the next
  // morning. What was missing is that it left no mark, so a closed day could
  // be rewritten and nobody would see it. The owner reads the daily report, so
  // the act is reported there rather than blocked.
  //
  // Reported on the day it was DONE, not only the day it was dated: a sale
  // backdated into 29 Aug appears on the 31 Aug sheet, which is the one the
  // owner is actually reading that evening.
  const retroactive: any[] = []
  // Defence in depth: this section is informational, so a failure here must
  // never cost the owner the sales tab. Before the migration runs the columns
  // do not exist and these selects 400 — degrade to an empty section instead.
  try {
  if (periodStart) {
    const inWindow = (q: any, col: string) => {
      let out = q.gte(col, periodStart)
      if (periodEnd) out = out.lt(col, periodEnd)
      // These queries start AT sales, so the plain column filter applies. The
      // ...OnSales variant is for queries rooted at payments, and using it here
      // asked PostgREST for an embedded 'sales' that isn't in the select.
      return applyBranchFilter(out, branch, branchIds)
    }
    const [enteredRows, voidedRows] = await Promise.all([
      fetchAllRows((from, to) => inWindow(admin.from('sales')
        .select('id, invoice_no, customer_name, total, created_at, entered_at, created_by, payment_status')
        .eq('vendor_id', vendor.id), 'entered_at').order('entered_at').order('id').range(from, to)),
      fetchAllRows((from, to) => inWindow(admin.from('sales')
        .select('id, invoice_no, customer_name, total, created_at, voided_at, voided_by')
        .eq('vendor_id', vendor.id).not('voided_at', 'is', null), 'voided_at').order('voided_at').order('id').range(from, to)),
    ])
    for (const s of enteredRows) {
      if (!s.entered_at || colomboDayOf(s.created_at) === colomboDayOf(s.entered_at)) continue
      retroactive.push({
        kind: colomboDayOf(s.created_at) < colomboDayOf(s.entered_at) ? 'backdated' : 'future_dated',
        invoice_no: s.invoice_no, customer_name: s.customer_name, amount: parseFloat(s.total || 0),
        actedAt: s.entered_at, belongsTo: s.created_at, by: s.created_by,
      })
    }
    for (const s of voidedRows) {
      if (colomboDayOf(s.created_at) === colomboDayOf(s.voided_at)) continue
      retroactive.push({
        kind: 'voided', invoice_no: s.invoice_no, customer_name: s.customer_name,
        amount: parseFloat(s.total || 0), actedAt: s.voided_at, belongsTo: s.created_at, by: s.voided_by,
      })
    }
    // Returns are already gathered above; one raised against an older invoice
    // is the same kind of event — the day it belongs to is not the day it moved.
    for (const r of returnsInPeriod) {
      if (!r.sale_created_at || colomboDayOf(r.sale_created_at) === colomboDayOf(r.created_at)) continue
      retroactive.push({
        kind: 'returned', invoice_no: r.invoice_no, customer_name: r.customer_name,
        amount: r.amount, actedAt: r.created_at, belongsTo: r.sale_created_at, by: r.created_by,
      })
    }

    // A SKU corrected on a sale from an earlier day changes that day's goods,
    // so it belongs here too — the honest operation is still a retroactive one,
    // and the owner should see it for the same reason.
    // Isolated: returns and backdated sales are gathered independently, and a
    // problem reading corrections must not empty the whole section.
    let corrections: any[] = []
    try {
    corrections = await fetchAllRows((from, to) => {
      let q = admin.from('sale_item_corrections')
        .select('sale_id, from_name, from_sku, to_name, to_sku, quantity, unit_price, reason, corrected_by, created_at, sale:sales!inner(invoice_no, customer_name, created_at)')
        .eq('vendor_id', vendor.id).gte('created_at', periodStart)
      if (periodEnd) q = q.lt('created_at', periodEnd)
      return q.order('created_at').order('sale_id').range(from, to)
    })
    } catch (e) { console.error('[sales] item corrections unavailable:', e) }
    for (const c of corrections as any[]) {
      const saleDay = c.sale?.created_at
      if (!saleDay || colomboDayOf(saleDay) === colomboDayOf(c.created_at)) continue
      retroactive.push({
        kind: 'corrected', invoice_no: c.sale?.invoice_no, customer_name: c.sale?.customer_name,
        amount: (Number(c.unit_price) || 0) * (Number(c.quantity) || 0),
        actedAt: c.created_at, belongsTo: saleDay, by: c.corrected_by,
        detail: `${c.from_name || c.from_sku || '?'} → ${c.to_name || c.to_sku || '?'}`,
        reason: c.reason || null,
      })
    }

    // Resolve the ids to names once. A staff row can be deleted; say so rather
    // than showing a bare uuid or an empty column.
    const actorIds = [...new Set(retroactive.map(r => r.by).filter(Boolean))]
    if (actorIds.length > 0) {
      const { data: staff } = await admin.from('vendor_staff')
        .select('user_id, name').eq('vendor_id', vendor.id).in('user_id', actorIds)
      const names: Record<string, string> = {}
      for (const st of staff || []) if (st.user_id) names[st.user_id] = st.name || 'Staff'
      if (vendor.user_id && actorIds.includes(vendor.user_id)) names[vendor.user_id] = 'Owner'
      for (const r of retroactive) r.byName = r.by ? (names[r.by] || 'removed staff') : 'not recorded'
    } else {
      for (const r of retroactive) r.byName = 'not recorded'
    }
    retroactive.sort((a, b) => String(b.actedAt).localeCompare(String(a.actedAt)))
  }
  } catch (e) {
    console.error('[sales] retroactive activity unavailable:', e)
    retroactive.length = 0
  }

  return NextResponse.json({
    retroactive,
    sales: allSales,
    stats: { totalRevenue, totalPaid, totalCredit, totalSales, totalItems, totalDiscount, avgSale: totalSales > 0 ? totalRevenue / totalSales : 0, totalCollections, totalReturns: totalReturnsAll, totalPiecesReturned },
    collectionsToday: positiveCollections,
    advanceOffsets,
    returnsInPeriod,
    topProducts,
    paymentBreakdown,
    dailyRevenue,
    topCustomers,
    vendor,
  })
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'create_sale') {
    const {
      customerId, customerName, customerPhone, items,
      discount, payments: paymentLines, notes, useAdvance, applyToOutstanding,
      acknowledgeCredit,
      saleDate, vehicleNo, mileageKm,
      // lk_tax fields (only present for WHEEL MART / lk_tax vendors)
      invoiceEntityId, documentType,
      customerAddress, customerTin, customerVatRegistered, customerIsInsurance,
      claimNo,
    } = body

    if (!items || items.length === 0) return NextResponse.json({ error: 'No items in sale' }, { status: 400 })

    // Validate + normalise item inputs (integer LKR, positive quantities)
    for (const item of items) {
      const q = Number(item.quantity)
      const p = Number(item.unitPrice)
      if (!Number.isFinite(q) || q < 1) return NextResponse.json({ error: `Invalid quantity for "${item.productName || 'item'}"` }, { status: 400 })
      if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: `Invalid price for "${item.productName || 'item'}"` }, { status: 400 })
      item.quantity = Math.round(q)
      item.unitPrice = Math.round(p)
    }

    // Reject negative payment lines — they'd skew paid_amount vs the payments
    // ledger (only positive lines become payment rows below).
    for (const pl of (paymentLines || [])) {
      const amt = Number(pl.amount)
      if (pl.amount !== '' && pl.amount != null && (!Number.isFinite(amt) || amt < 0))
        return NextResponse.json({ error: 'Invalid payment amount' }, { status: 400 })
    }

    // Auto-create customer if name provided but no ID
    let resolvedCustomerId = customerId || null
    if (!resolvedCustomerId && customerName?.trim()) {
      if (customerPhone?.trim()) {
        const { data: existing } = await admin.from('customers').select('id')
          .eq('vendor_id', vendor.id).eq('phone', customerPhone.trim()).single()
        if (existing) resolvedCustomerId = existing.id
      }
      if (!resolvedCustomerId) {
        const { data: newCust } = await admin.from('customers').insert({
          vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,
        }).select().single()
        if (newCust) resolvedCustomerId = newCust.id
      }
    }

    const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    const roundedDiscount = Math.min(subtotal, Math.max(0, Math.round(Number(discount) || 0)))
    const total = Math.max(0, subtotal - roundedDiscount)

    // ── lk_tax: atomic serial + VAT calculation ────────────────
    const invoiceMode = await getInvoiceMode(vendor.id)
    const isLkTax = invoiceMode === 'lk_tax' && !!invoiceEntityId

    let invoiceNo: string
    let receiptNo: string | null = null
    let taxSerial: string | null = null
    let netAmount: number | null = null
    let vatAmount: number | null = null
    let resolvedDocType: 'receipt' | 'tax_invoice' = 'receipt'
    let resolvedEntityId: string | null = null

    if (isLkTax) {
      const entity = await getInvoiceEntity(invoiceEntityId)
      if (!entity) return NextResponse.json({ error: 'Invoice entity not found' }, { status: 400 })

      // Pvt Ltd (lk_tax entity) always issues tax invoices — gazette requirement.
      // Proprietorship entities issue receipts. The client-supplied documentType is ignored.
      resolvedDocType = entity.invoice_mode === 'lk_tax' ? 'tax_invoice' : 'receipt'
      resolvedEntityId = invoiceEntityId

      const supplyDate = saleDate ? new Date(saleDate) : new Date()

      // Tax invoice serials embed the YYMMM period — backdating into a prior
      // month would break the gapless monthly sequence. Allow only current month.
      if (resolvedDocType === 'tax_invoice' && saleDate) {
        const now = new Date()
        if (supplyDate.getFullYear() !== now.getFullYear() || supplyDate.getMonth() !== now.getMonth()) {
          return NextResponse.json({ error: 'Tax invoice date must be within the current month' }, { status: 400 })
        }
      }

      const serial = await reserveSerial(invoiceEntityId, entity, resolvedDocType, supplyDate)
      invoiceNo = serial.invoiceNo
      receiptNo = serial.receiptNo
      taxSerial = serial.taxSerial

      // VAT is extracted from VAT-inclusive prices (prices are what customer pays)
      const vatRate = await getVatRate(vendor.id)
      vatAmount = Math.round(total * vatRate / (100 + vatRate))
      netAmount = total - vatAmount

      // Snapshot / update customer address + TIN for tax invoices
      if (resolvedDocType === 'tax_invoice' && resolvedCustomerId) {
        const custPatch: any = {}
        if (customerAddress?.trim()) custPatch.address = customerAddress.trim()
        if (customerVatRegistered !== undefined) custPatch.vat_registered = customerVatRegistered
        if (customerTin?.trim() && customerVatRegistered) custPatch.tin = customerTin.trim()
        if (customerIsInsurance !== undefined) custPatch.is_insurance = !!customerIsInsurance
        if (Object.keys(custPatch).length > 0) {
          await admin.from('customers').update(custPatch).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
        }
      }
    } else {
      invoiceNo = await generateInvoiceNo(vendor.id, vendor.name)
    }

    // Step 1: How much cash/cheque/bank was paid
    const cashPaid = (paymentLines || []).reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0)

    // Step 2: Check customer advance balance
    let customerAdvance = 0
    if (resolvedCustomerId) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', resolvedCustomerId).eq('vendor_id', vendor.id).single()
      if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 400 })
      customerAdvance = parseFloat(cust?.advance_balance || 0)
    }
    // Credit on account is applied first, or billing without it is explicit.
    // A fresh cash line on top of a refund-to-advance double-counts the money.
    const creditProblem = creditOnAccountProblem({ customerName, customerAdvance, total, cashPaid, useAdvance: !!useAdvance, acknowledged: !!acknowledgeCredit })
    if (creditProblem) return NextResponse.json(creditProblem, { status: 409 })

    // Step 3: Apply advance to THIS bill if enabled
    let advanceUsedForBill = 0
    if (useAdvance && customerAdvance > 0) {
      advanceUsedForBill = Math.min(customerAdvance, Math.max(0, total - cashPaid))
    }

    // Step 4: Total applied to this bill
    const paidForThisBill = Math.min(total, cashPaid + advanceUsedForBill)
    const billBalance = Math.max(0, total - paidForThisBill)
    const excessPayment = Math.max(0, (cashPaid + advanceUsedForBill) - total)

    let paymentStatus = 'paid'
    if (billBalance > 0 && paidForThisBill > 0) paymentStatus = 'partial'
    else if (billBalance > 0 && paidForThisBill === 0) paymentStatus = 'credit'

    const primaryMethod = paymentLines && paymentLines.length > 0
      ? paymentLines.sort((a: any, b: any) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0].method || 'cash'
      : (advanceUsedForBill > 0 ? 'advance' : billBalance > 0 ? 'credit' : 'cash')

    // Create sale
    const saleRecord: any = { created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
      invoice_no: invoiceNo, customer_name: customerName || 'Walk-in Customer',
      customer_phone: customerPhone || null, subtotal, discount: roundedDiscount,
      total, paid_amount: paidForThisBill, balance_due: billBalance,
      payment_method: primaryMethod, payment_status: paymentStatus,
      notes: notes || null,
      vehicle_no: vehicleNo || null,
      // Odometer at service time — wheel alignment is recorded against it
      mileage_km: Number.isFinite(parseInt(mileageKm)) && parseInt(mileageKm) >= 0 ? parseInt(mileageKm) : null,
    }
    if (saleDate) {
      // A date with no time parses as midnight UTC, which is 5:30am Colombo —
      // the right DAY, but sitting exactly on a UTC period boundary, which is
      // where "is this before the period start" comparisons go wrong. Two bugs
      // this month traced back to it. Stamp date-only sales at Colombo midday
      // instead: unambiguously inside the day and nowhere near an edge.
      saleRecord.created_at = /^\d{4}-\d{2}-\d{2}$/.test(String(saleDate))
        ? new Date(`${saleDate}T12:00:00+05:30`).toISOString()
        : new Date(saleDate).toISOString()
    }

    // lk_tax extra fields
    if (isLkTax) {
      saleRecord.invoice_entity_id = resolvedEntityId
      saleRecord.document_type     = resolvedDocType
      saleRecord.receipt_no        = receiptNo
      saleRecord.tax_serial        = taxSerial
      saleRecord.net_amount        = netAmount
      saleRecord.vat_amount        = vatAmount
      saleRecord.date_supply       = saleDate
        ? new Date(saleDate).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0]
      // Snapshot purchaser details (columns added in Phase 2 migration)
      if (resolvedDocType === 'tax_invoice') {
        saleRecord.customer_address = customerAddress?.trim() || null
        saleRecord.customer_tin     = (customerVatRegistered && customerTin?.trim()) ? customerTin.trim() : null
      }
    }

    const { data: sale, error: saleError } = await admin.from('sales').insert(saleRecord).select().single()

    if (saleError) {
      // The gazette serial was already minted (committed) by reserveSerial above.
      // If the real sale row failed to insert, write a minimal VOID row carrying
      // that serial so the number stays in the ledger and the sequence is gapless
      // (a retry mints the NEXT serial). Best-effort — don't mask the real error.
      if (isLkTax && taxSerial) {
        await admin.from('sales').insert({
          created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, invoice_no: invoiceNo, customer_name: customerName || 'VOID',
          subtotal: 0, discount: 0, total: 0, net_amount: 0, vat_amount: 0,
          paid_amount: 0, balance_due: 0, total_amount_due: 0,
          payment_method: 'cash', payment_status: 'voided', voided_at: new Date().toISOString(),
          invoice_entity_id: resolvedEntityId, document_type: resolvedDocType,
          tax_serial: taxSerial, receipt_no: receiptNo,
          notes: 'VOID — sale failed to save, serial preserved: ' + saleError.message,
        }).then(() => {}, () => {})
      }
      return NextResponse.json({ error: saleError.message }, { status: 400 })
    }

    // Create sale items
    const saleItems = items.map((item: any) => ({
      sale_id: sale.id, product_id: item.productId, product_name: item.productName,
      product_sku: item.productSku || null, quantity: item.quantity,
      unit_price: item.unitPrice, unit_cost: item.unitCost || null,
      total: item.quantity * item.unitPrice,
      // sscl_stream: inventory items = PART (50% base), manual service lines = SVC (100% base)
      sscl_stream: item.ssclStream || (item.productId ? 'PART' : 'SVC'),
    }))
    const { error: itemsError } = await admin.from('sale_items').insert(saleItems)
    if (itemsError) {
      if (taxSerial) {
        // Gazette serial already reserved — keep the row as VOID to preserve the gapless sequence.
        await admin.from('sales').update({ payment_status: 'voided', voided_at: new Date().toISOString(), notes: 'VOID — sale items failed to save' }).eq('id', sale.id)
      } else {
        await admin.from('sales').delete().eq('id', sale.id)
      }
      return NextResponse.json({ error: itemsError.message }, { status: 400 })
    }

    // Insurance claim spine: tag the invoice with its claim. Best-effort — a
    // linking problem is a warning on the receipt, never a failed sale.
    let claimWarning: string | null = null
    if ((claimNo || customerIsInsurance) && resolvedCustomerId) {
      const link = await linkSaleToClaim(admin, vendor.id, sale.id, resolvedCustomerId, claimNo,
        { vehicleNo: vehicleNo || null, createdBy: null })
      claimWarning = link.warning
    }

    // Record all payment lines in one batch insert
    const paymentRecords: any[] = []
    for (const pl of (paymentLines || [])) {
      if (parseFloat(pl.amount) > 0) {
        paymentRecords.push({
          sale_id: sale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
          cheque_number: pl.chequeNumber || null, cheque_date: pl.chequeDate || null,
          bank_ref: pl.bankRef || null, notes: pl.notes || null,
        })
      }
    }
    if (advanceUsedForBill > 0) {
      paymentRecords.push({
        sale_id: sale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
        amount: advanceUsedForBill, payment_method: 'advance',
        // the label a tax invoice prints instead of ADVANCE (src/lib/advanceSource.ts)
        source_method: resolvedCustomerId ? await resolveAdvanceSource(admin, vendor.id, resolvedCustomerId) : 'cash',
        notes: 'Used from advance balance',
      })
    }
    if (paymentRecords.length > 0) {
      const { error: payError } = await admin.from('payments').insert(paymentRecords)
      if (payError) console.error('Payment records insert failed for sale', sale.id, payError.message)
    }

    // Step 5: If there's excess payment AND outstanding invoices, apply to oldest first
    let excessAppliedToOutstanding = 0
    const settledInvoices: string[] = []
    if (excessPayment > 0 && resolvedCustomerId && applyToOutstanding !== false) {
      const { data: outstandingSales } = await admin
        .from('sales')
        .select('id, invoice_no, total, paid_amount, balance_due')
        .eq('vendor_id', vendor.id)
        .eq('customer_id', resolvedCustomerId)
        .gt('balance_due', 0)
        .neq('payment_status', 'voided')
        .neq('id', sale.id)
        .order('created_at', { ascending: true })

      let remaining = excessPayment
      for (const oldSale of (outstandingSales || [])) {
        if (remaining <= 0) break
        const oldBalance = parseFloat(oldSale.balance_due)
        const applyAmount = Math.min(remaining, oldBalance)

        await admin.from('payments').insert({
          created_by: vendor.callerUserId || null, sale_id: oldSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: applyAmount, payment_method: 'settlement',
          notes: `Auto-applied from invoice ${invoiceNo}`,
        })

        const newOldPaid = parseFloat(oldSale.paid_amount) + applyAmount
        const newOldBalance = Math.max(0, oldBalance - applyAmount)
        await admin.from('sales').update({
          paid_amount: newOldPaid, balance_due: newOldBalance,
          payment_status: newOldBalance <= 0 ? 'paid' : 'partial',
        }).eq('id', oldSale.id)

        excessAppliedToOutstanding += applyAmount
        remaining -= applyAmount
        if (newOldBalance <= 0) settledInvoices.push(oldSale.invoice_no)
      }

      // Whatever is still remaining goes to advance
      if (remaining > 0 && resolvedCustomerId) {
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill) + remaining
        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
      } else {
        // Just deduct what was used
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
        if (resolvedCustomerId) await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
      }
    } else {
      // No outstanding or not applying - excess goes straight to advance
      let newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
      if (excessPayment > 0) newAdvance += excessPayment
      if (resolvedCustomerId) await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
    }

    // Step 6: Auto-deduct stock (atomic per product)
    const stockItems = items.filter((item: any) => item.productId)
    if (stockItems.length > 0) {
      await Promise.all(
        stockItems.map((item: any) => adjustProductQuantity(admin, item.productId, vendor.id, -item.quantity))
      )
    }

    // Step 7: FIFO cost consumption — populate unit_cost on each product sale item
    if (stockItems.length > 0) {
      const { data: insertedSaleItems } = await admin
        .from('sale_items').select('id, product_id, quantity').eq('sale_id', sale.id)
      for (const si of (insertedSaleItems || [])) {
        if (!si.product_id) continue
        const { data: totalCost } = await admin.rpc('consume_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: si.product_id, p_quantity: si.quantity,
        })
        if (totalCost && totalCost > 0) {
          await admin.from('sale_items')
            .update({ unit_cost: Math.round(totalCost / si.quantity) })
            .eq('id', si.id)
        }
      }
    }

    // Step 8: transferred parts sold here are sold by the shop that sent them
    // too — raise that shop's sale at the transfer cost (src/lib/sellThrough.ts).
    // Best effort: their bookkeeping must never fail this till.
    let sellThroughNote = ''
    try {
      const { data: soldLines } = await admin.from('sale_items').select('id, product_id, quantity').eq('sale_id', sale.id)
      const st = await recordSellThrough(admin, vendor.id, { id: sale.id, invoice_no: invoiceNo, created_at: saleRecord.created_at || null }, soldLines || [], vendor.callerUserId || null)
      for (const r of st.raised) sellThroughNote += ` | ${r.vendorName} billed ${r.invoiceNo} Rs.${r.total.toLocaleString()}`
      if (st.warning) sellThroughNote += ` | ⚠️ ${st.warning}`
    } catch (e: any) { sellThroughNote = ` | ⚠️ Sell-through not recorded: ${e?.message || e}` }

    // Fetch complete sale
    const { data: completeSale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', sale.id).single()

    // Build message
    let msg = `Invoice ${invoiceNo}`
    if (paymentStatus === 'paid') msg += ' — Paid'
    else if (paymentStatus === 'partial') msg += ` — Rs.${billBalance.toLocaleString()} on credit`
    else msg += ` — Full credit Rs.${total.toLocaleString()}`
    if (advanceUsedForBill > 0) msg += ` | Rs.${advanceUsedForBill.toLocaleString()} from advance`
    if (excessAppliedToOutstanding > 0) msg += ` | Rs.${excessAppliedToOutstanding.toLocaleString()} applied to old invoices`
    if (settledInvoices.length > 0) msg += ` (cleared: ${settledInvoices.join(', ')})`
    const finalAdvance = excessPayment > excessAppliedToOutstanding ? excessPayment - excessAppliedToOutstanding : 0
    if (finalAdvance > 0) msg += ` | Rs.${finalAdvance.toLocaleString()} to advance`
    if (claimWarning) msg += ` | ⚠️ ${claimWarning}`
    msg += sellThroughNote

    // Calculate total amount due across ALL invoices for this customer and save to DB.
    // Use resolvedCustomerId (covers phone-matched and auto-created customers, not
    // just ones the client sent an id for).
    let totalAmountDue = 0
    if (resolvedCustomerId) {
      const { data: allCustomerSales } = await admin
        .from('sales')
        .select('balance_due')
        .eq('vendor_id', vendor.id)
        .eq('customer_id', resolvedCustomerId)
        .neq('payment_status', 'voided')
        .gt('balance_due', 0)
      totalAmountDue = (allCustomerSales || []).reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      // Save snapshot to the sale record
      await admin.from('sales').update({ total_amount_due: totalAmountDue }).eq('id', sale.id)
    }

    // Re-fetch with updated total_amount_due
    const { data: finalSale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', sale.id).single()

    return NextResponse.json({
      success: true, sale: finalSale || completeSale,
      advanceUsed: advanceUsedForBill,
      appliedToOutstanding: excessAppliedToOutstanding,
      settledInvoices,
      newAdvance: finalAdvance,
      totalAmountDue,
      message: msg,
    })
  }

  // ── PROMOTE a proprietor receipt to a Pvt Ltd tax invoice ─────────────────
  // Within 30 days, for customers who are not VAT-registered. The customer has
  // already paid, so the TOTAL must not move — VAT is carved OUT of what they
  // paid, not added on top. The business absorbs it; the customer's receipt
  // still reconciles to the cash they handed over.
  if (action === 'promote_to_tax_invoice') {
    const { saleId, acknowledgeWarnings } = body
    if (!saleId) return NextResponse.json({ success: false, error: 'saleId required' }, { status: 400 })

    const admin = createAdminClient()
    const check = await checkPromotable(admin, vendor.id, saleId)
    if (!check.eligible) return NextResponse.json({ success: false, error: check.reason }, { status: 400 })

    // Re-evaluated here rather than trusted from the client: the operator must
    // have been shown these exact conditions, and they can change between the
    // pre-flight check and the click.
    if (check.warnings.length > 0 && !acknowledgeWarnings) {
      return NextResponse.json({ success: false, needsAcknowledgement: true, warnings: check.warnings }, { status: 409 })
    }

    const { data: sale } = await admin.from('sales')
      .select('id, receipt_no, total, date_supply, created_at, invoice_entity_id').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ success: false, error: 'Sale not found' }, { status: 404 })
    const fromEntityId = sale.invoice_entity_id

    const target = check.targetEntity!
    const { data: targetRow } = await admin.from('invoice_entities')
      .select('id, serial_qqqq, receipt_prefix').eq('id', target.id).single()

    const vatRate = await getVatRate(vendor.id)
    const total = Math.round(Number(sale.total || 0))
    // Carve VAT out of the paid total — the price already included it as far as
    // the customer is concerned.
    const net = Math.round(total / (1 + vatRate / 100))
    const vat = total - net

    // check.supplyDate is the carried-over date, not the day of the sale — the
    // serial's period and the printed dates all follow it.
    const supplyDate = new Date(`${check.supplyDate}T00:00:00+05:30`)
    let serial
    try {
      serial = await reserveSerial(target.id, targetRow as any, 'tax_invoice', supplyDate)
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message || 'Serial generation failed' }, { status: 500 })
    }

    // receipt_no is kept, not cleared: the customer holds that piece of paper
    // and the receipt sequence must stay gapless. One sale, two identifiers.
    const { error: upErr } = await admin.from('sales').update({
      invoice_entity_id: target.id,
      document_type:     'tax_invoice',
      tax_serial:        serial.taxSerial,
      invoice_no:        serial.taxSerial,
      net_amount:        net,
      vat_amount:        vat,
      date_supply:       check.supplyDate,
      promoted_at:       new Date().toISOString(),
      promoted_from_receipt_no: sale.receipt_no,
    }).eq('id', saleId).eq('vendor_id', vendor.id)

    if (upErr) {
      // The serial was minted a moment ago and nothing has been issued under
      // it, so give it back rather than leaving a hole in a sequence that is
      // required to be gapless. A failed promotion must cost nothing.
      const num = parseInt(String(serial.taxSerial).split('_')[2], 10)
      const reclaimed = await releaseSerial(target.id, check.period!, num)
      return NextResponse.json({
        success: false,
        error: upErr.message,
        serialReclaimed: reclaimed,
        note: reclaimed
          ? undefined
          : `${serial.taxSerial} was reserved and could not be reclaimed — it must be recorded as VOID to keep the sequence gapless.`,
      }, { status: 500 })
    }

    await admin.from('invoice_promotion_log').insert({
      vendor_id: vendor.id, sale_id: saleId, action: 'promote',
      receipt_no: sale.receipt_no, tax_serial: serial.taxSerial,
      from_entity_id: fromEntityId, to_entity_id: target.id,
      total, net_amount: net, vat_amount: vat,
      stamped_date: check.supplyDate, sale_date: check.originalSaleDate,
      actor_id: (vendor as any).callerUserId || null, actor_role: 'promoter',
    })

    return NextResponse.json({
      success: true,
      taxSerial: serial.taxSerial,
      net, vat, total,
      warnings: check.warnings,
      message: `${sale.receipt_no} is now ${serial.taxSerial} — Rs.${net.toLocaleString()} + VAT Rs.${vat.toLocaleString()}, total unchanged at Rs.${total.toLocaleString()}`,
    })
  }

  // ── REVERSE a promotion: tax invoice back to its receipt ──────────────────
  // Owner, or a manager authorised for both stores. Withdrawing a tax invoice
  // moves output VAT out of a period that may already be filed, so it sits
  // above the single-branch manager who runs one shop's day.
  if (action === 'reverse_promotion') {
    const { saleId, reason } = body
    if (!saleId) return NextResponse.json({ success: false, error: 'saleId required' }, { status: 400 })

    const admin = createAdminClient()
    const userId = (vendor as any).callerUserId
    const perm = await mayReversePromotion(admin, vendor, userId)
    if (!perm.allowed) {
      return NextResponse.json({
        success: false,
        error: 'Reversing a tax invoice is limited to the owner and managers authorised for both stores.',
      }, { status: 403 })
    }
    if (!String(reason || '').trim()) {
      return NextResponse.json({ success: false, error: 'A reason is required — this withdraws a tax invoice and moves output VAT' }, { status: 400 })
    }

    const check = await checkReversible(admin, vendor.id, saleId)
    if (!check.eligible) return NextResponse.json({ success: false, error: check.reason }, { status: 400 })

    const { data: sale } = await admin.from('sales')
      .select('*').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ success: false, error: 'Sale not found' }, { status: 404 })

    // Where it goes back to: the proprietor entity of the same branch.
    const { data: toEntity } = await admin.from('invoice_entities')
      .select('id, name, branch').eq('id', sale.invoice_entity_id).single()
    const { data: propEntity } = await admin.from('invoice_entities')
      .select('id, name').eq('vendor_id', vendor.id)
      .eq('invoice_mode', 'simple').eq('branch', toEntity?.branch).maybeSingle()
    if (!propEntity) {
      return NextResponse.json({ success: false, error: `No proprietor entity for the ${toEntity?.branch} branch to send it back to` }, { status: 400 })
    }

    const receiptNo = sale.promoted_from_receipt_no || sale.receipt_no
    const deadSerial = sale.tax_serial

    // The serial is NOT handed back. A printed invoice may already be with the
    // customer, and the sequence must never issue the same number twice — so
    // it is voided into the ledger instead, which keeps the run gapless
    // without any chance of a duplicate.
    const { error: voidErr } = await admin.from('sales').insert({
      created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, invoice_no: deadSerial, customer_name: 'VOID — promotion reversed',
      subtotal: 0, discount: 0, total: 0, net_amount: 0, vat_amount: 0,
      paid_amount: 0, balance_due: 0, total_amount_due: 0,
      payment_method: 'cash', payment_status: 'voided', voided_at: new Date().toISOString(),
      invoice_entity_id: sale.invoice_entity_id, document_type: 'tax_invoice',
      tax_serial: deadSerial,
      date_supply: sale.date_supply,
      notes: `VOID — promotion of ${receiptNo} reversed. Reason: ${String(reason).trim()}`,
    })
    if (voidErr) return NextResponse.json({ success: false, error: 'Could not void the serial: ' + voidErr.message }, { status: 500 })

    // The sale itself goes back to being the receipt it was.
    const { error: upErr } = await admin.from('sales').update({
      invoice_entity_id: propEntity.id,
      document_type:     'receipt',
      tax_serial:        null,
      invoice_no:        receiptNo,
      receipt_no:        receiptNo,
      net_amount:        Math.round(Number(sale.total || 0)),
      vat_amount:        0,
      date_supply:       String(sale.created_at).slice(0, 10),
      promoted_at:       null,
      promoted_from_receipt_no: null,
    }).eq('id', saleId).eq('vendor_id', vendor.id)
    if (upErr) return NextResponse.json({ success: false, error: upErr.message }, { status: 500 })

    await admin.from('invoice_promotion_log').insert({
      vendor_id: vendor.id, sale_id: saleId, action: 'reverse',
      receipt_no: receiptNo, tax_serial: deadSerial,
      from_entity_id: sale.invoice_entity_id, to_entity_id: propEntity.id,
      total: Math.round(Number(sale.total || 0)), net_amount: Math.round(Number(sale.total || 0)), vat_amount: 0,
      stamped_date: String(sale.created_at).slice(0, 10), sale_date: String(sale.created_at).slice(0, 10),
      reason: String(reason).trim(), actor_id: userId, actor_role: perm.role,
    })

    return NextResponse.json({
      success: true,
      message: `${deadSerial} withdrawn and voided — the sale is ${receiptNo} again. Output VAT of Rs.${(check.vatAmount || 0).toLocaleString()} is removed.`,
    })
  }

  if (action === 'void_sale') {
    const { saleId, refundMethod } = body
    // refundMethod: 'advance' (credit to customer) | 'cash' (cash back, just record it)
    const { data: sale } = await admin.from('sales').select('*, items:sale_items(*), payments:payments(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'Already voided' }, { status: 400 })

    // Atomically claim the void BEFORE side effects — a double-tap would
    // otherwise pass the check above twice and restore stock/advance twice.
    const { data: voidClaim } = await admin.from('sales')
      .update({ payment_status: 'voided' })
      .eq('id', saleId).eq('vendor_id', vendor.id)
      .neq('payment_status', 'voided')
      .select('id').maybeSingle()
    if (!voidClaim) return NextResponse.json({ error: 'Already voided' }, { status: 400 })

    // 1. Restore stock + FIFO cost layers for each item
    const voidDate = new Date().toISOString().slice(0, 10)
    for (const item of (sale.items || [])) {
      if (item.product_id) {
        await adjustProductQuantity(admin, item.product_id, vendor.id, item.quantity)
        // Restore FIFO layer at original unit_cost (puts stock back for future sales)
        if (parseInt(item.unit_cost || 0) > 0) {
          await admin.rpc('restore_fifo_cost', {
            p_vendor_id: vendor.id, p_product_id: item.product_id,
            p_quantity: item.quantity, p_unit_cost: parseInt(item.unit_cost),
            p_received_at: voidDate,
          })
        }
      }
    }

    // 2. Calculate what was paid
    const payments = sale.payments || []
    const cashPaid = payments.filter((p: any) => ['cash','cheque','bank','card'].includes(p.payment_method)).reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0)
    const advanceUsed = payments.filter((p: any) => p.payment_method === 'advance').reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0)
    const balanceDue = parseFloat(sale.balance_due || 0)

    // 3. Handle customer balance adjustments
    if (sale.customer_id) {
      const { data: customer } = await admin.from('customers').select('advance_balance').eq('id', sale.customer_id).single()
      if (customer) {
        let newAdvance = parseFloat(customer.advance_balance || 0)

        // Restore advance that was used for this sale
        if (advanceUsed > 0) newAdvance += advanceUsed

        // If cash was paid, either refund to advance or just record cash back
        if (cashPaid > 0 && refundMethod === 'advance') {
          newAdvance += cashPaid
        }

        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', sale.customer_id)

        // If sale had outstanding balance (credit), reduce it — already handled by voiding the sale
      }
    }

    // 4. Reverse any auto-settlements that were applied FROM this sale to older invoices.
    // These live on the OLD sales, not this one — find them by notes referencing our invoice
    const { data: settlementPayments } = await admin
      .from('payments')
      .select('id, sale_id, amount')
      .eq('vendor_id', vendor.id)
      .eq('payment_method', 'settlement')
      .ilike('notes', `%from invoice ${sale.invoice_no}%`)
    if (settlementPayments && settlementPayments.length > 0) {
      for (const sp of settlementPayments) {
        // Reverse the balance on the old sale
        const { data: oldSale } = await admin.from('sales').select('paid_amount, balance_due, total').eq('id', sp.sale_id).single()
        if (oldSale) {
          const restoredBalance = parseFloat(oldSale.balance_due) + parseFloat(sp.amount)
          const restoredPaid = Math.max(0, parseFloat(oldSale.paid_amount) - parseFloat(sp.amount))
          await admin.from('sales').update({
            paid_amount: restoredPaid,
            balance_due: restoredBalance,
            payment_status: restoredBalance > 0 ? (restoredPaid > 0 ? 'partial' : 'credit') : 'paid',
          }).eq('id', sp.sale_id)
        }
        // Delete the settlement payment record
        await admin.from('payments').delete().eq('id', sp.id)
      }
    }

    // 5. Mark sale as voided — set voided_at timestamp (keeps gazette serial in ledger)
    const voidedAt = new Date().toISOString()
    await admin.from('sales').update({
      payment_status: 'voided',
      voided_at: voidedAt, voided_by: vendor.callerUserId || null,
      balance_due: 0,
      notes: (sale.notes || '') + '\nVOIDED: ' + voidedAt + (refundMethod === 'advance' ? ' | Refund to advance' : ' | Cash refund')
    }).eq('id', saleId)

    const messages = ['Sale voided, stock restored']
    // 6. The sending shop's mirrored sale (transferred parts) goes with it
    try {
      const mirrored = await voidSellThrough(admin, saleId, vendor.callerUserId || null)
      if (mirrored.length > 0) messages.push(`Also voided at the sending shop: ${mirrored.join(', ')}`)
    } catch (e: any) { messages.push(`⚠️ Sending shop's invoice not voided: ${e?.message || e}`) }
    if (advanceUsed > 0) messages.push(`Rs.${advanceUsed.toLocaleString()} advance restored`)
    if (cashPaid > 0 && refundMethod === 'advance') messages.push(`Rs.${cashPaid.toLocaleString()} added to advance`)
    if (cashPaid > 0 && refundMethod !== 'advance') messages.push(`Rs.${cashPaid.toLocaleString()} cash to refund`)
    if (balanceDue > 0) messages.push(`Rs.${balanceDue.toLocaleString()} outstanding cleared`)

    return NextResponse.json({ success: true, message: messages.join('. '), advanceRestored: advanceUsed, cashRefund: refundMethod !== 'advance' ? cashPaid : 0, creditedToAdvance: (refundMethod === 'advance' ? cashPaid : 0) + advanceUsed })
  }

  // ─── RETURN ITEMS (partial or full) ───
  // ── Correct a wrong SKU on a finalised sale ────────────────────────────────
  //
  // The operation the shop was missing. Without it, fixing a mis-picked SKU
  // meant returning the item and re-billing the right one, which leaves a
  // return and a sale that have to be explained — and tempts whoever did it to
  // backdate the re-bill so the day's figures look untouched.
  //
  // This swaps the product on the line and moves the stock. The date, quantity
  // and price do not change, because nothing about the transaction changed —
  // only which part left the shelf. A correction that also re-priced would be a
  // different sale, and that genuinely does need a return.
  if (action === 'correct_item') {
    const { saleId, saleItemId, newProductId, reason } = body
    if (!saleId || !saleItemId || !newProductId) return NextResponse.json({ error: 'saleId, saleItemId and newProductId are required' }, { status: 400 })

    const { data: sale } = await admin.from('sales')
      .select('id, invoice_no, tax_serial, document_type, payment_status, voided_at, created_at')
      .eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    // A gazette tax invoice is immutable once issued: an item change means
    // voiding it and issuing a corrected one on the next serial. Silently
    // editing the goods on a document the customer holds — and may have
    // claimed input VAT against — is exactly what the rule forbids.
    if (sale.tax_serial) {
      return NextResponse.json({
        error: `${sale.invoice_no} is a tax invoice (${sale.tax_serial}). A tax invoice cannot be edited — void it and issue a corrected invoice on the next serial.`,
      }, { status: 409 })
    }
    if (sale.voided_at || sale.payment_status === 'voided') return NextResponse.json({ error: 'This sale is voided' }, { status: 409 })

    const { data: line } = await admin.from('sale_items')
      .select('id, sale_id, product_id, product_name, product_sku, quantity, unit_price, unit_cost, returned_quantity')
      .eq('id', saleItemId).eq('sale_id', saleId).single()
    if (!line) return NextResponse.json({ error: 'Line not found on this sale' }, { status: 404 })
    if (Number(line.returned_quantity) > 0) {
      return NextResponse.json({ error: 'Part of this line has already been returned — correct it with a return instead' }, { status: 409 })
    }
    if (line.product_id === newProductId) return NextResponse.json({ error: 'That is already the item on this line' }, { status: 400 })

    const { data: newProduct } = await admin.from('products')
      .select('id, name, sku, quantity, product_type').eq('id', newProductId).eq('vendor_id', vendor.id).single()
    if (!newProduct) return NextResponse.json({ error: 'Replacement product not found' }, { status: 404 })

    const qty = Number(line.quantity) || 0

    // Preflight the audit table BEFORE anything moves. An in-place edit that
    // failed to record itself would be worse than the return-and-rebill this
    // replaces — silent, and invisible on the daily report. If the log is not
    // reachable, nothing happens at all.
    const { error: auditProbe } = await admin.from('sale_item_corrections').select('id').limit(1)
    if (auditProbe) {
      return NextResponse.json({
        error: 'The correction log is unavailable, so nothing was changed — run supabase-item-corrections.sql.',
      }, { status: 503 })
    }

    // Put the wrong part back before taking the right one, so a shortage on the
    // replacement cannot leave the shop having given up both.
    if (line.product_id) {
      await adjustProductQuantity(admin, line.product_id, vendor.id, qty)
      if (parseInt(String(line.unit_cost || 0)) > 0) {
        await admin.rpc('restore_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: line.product_id,
          p_quantity: qty, p_unit_cost: parseInt(String(line.unit_cost)),
          p_received_at: new Date().toISOString().slice(0, 10),
        })
      }
    }

    await adjustProductQuantity(admin, newProduct.id, vendor.id, -qty)
    const { data: consumed } = await admin.rpc('consume_fifo_cost', {
      p_vendor_id: vendor.id, p_product_id: newProduct.id, p_quantity: qty,
    })
    const newUnitCost = consumed && consumed > 0 ? Math.round(consumed / qty) : null

    // unit_price, quantity and total are deliberately untouched: the customer
    // pays what they always paid, and the sale's date does not move.
    const { error: lineErr } = await admin.from('sale_items').update({
      product_id: newProduct.id, product_name: newProduct.name, product_sku: newProduct.sku,
      unit_cost: newUnitCost, // Goods off the shelf are PART, the same rule the POS applies to any
      // line that carries a product. No service-flagged products exist yet.
      sscl_stream: newProduct.product_type === 'service' ? 'SVC' : 'PART',
    }).eq('id', line.id)
    if (lineErr) return NextResponse.json({ error: 'Could not update the line: ' + lineErr.message }, { status: 500 })

    const { error: auditErr } = await admin.from('sale_item_corrections').insert({
      vendor_id: vendor.id, sale_id: saleId, sale_item_id: line.id,
      from_product_id: line.product_id, from_sku: line.product_sku, from_name: line.product_name,
      to_product_id: newProduct.id, to_sku: newProduct.sku, to_name: newProduct.name,
      quantity: qty, unit_price: Math.round(Number(line.unit_price) || 0),
      reason: (reason || '').trim() || null,
      corrected_by: (vendor as any).callerUserId || null,
    })
    if (auditErr) {
      // Stock has moved and the line already reads the new part. Say plainly
      // that the record is missing rather than reporting success — an
      // unlogged in-place edit is worse than the workaround this replaces.
      console.error('[sales] correction applied but NOT logged:', auditErr)
      return NextResponse.json({
        error: 'The item was corrected but the change could not be logged (' + auditErr.message + '). Tell the owner — it will not appear on the daily report.',
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `${sale.invoice_no}: ${line.product_name} → ${newProduct.name}. ${qty} back on the shelf, ${qty} off ${newProduct.sku}. Date and amount unchanged.`,
    })
  }

  if (action === 'return_items') {
    const { saleId, returnItems, refundMethod, return_reason: returnReason } = body
    // returnItems: [{ saleItemId, quantity }]
    // refundMethod: 'advance' | 'cash'
    if (!saleId || !returnItems || !Array.isArray(returnItems) || returnItems.length === 0)
      return NextResponse.json({ error: 'No items to return' }, { status: 400 })

    const { data: sale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'Sale is already voided' }, { status: 400 })
    if (sale.tax_serial) {
      // CLAUDE.md: a return against a tax invoice requires a Credit Note (CRN) —
      // the gazette-stamped amounts are immutable and VAT must be reversed legally.
      return NextResponse.json({ error: 'This is a tax invoice — process the return as a Credit Note instead' }, { status: 400 })
    }

    // If the invoice had a discount, prorate it across returned lines — refunding
    // raw unit prices would hand back more money than the customer actually paid.
    const saleSubtotalForFactor = parseFloat(sale.subtotal || 0)
    const discountFactor = saleSubtotalForFactor > 0 ? parseFloat(sale.total || 0) / saleSubtotalForFactor : 1

    let totalRefund = 0      // money to refund (discount-prorated)
    let totalRefundRaw = 0   // raw line value, before any invoice discount
    const returnedDetails: string[] = []
    const claimedReturns: { saleItemId: string; quantity: number }[] = []

    // 1. Process each return item
    for (const ri of returnItems) {
      const saleItem = (sale.items || []).find((si: any) => si.id === ri.saleItemId)
      if (!saleItem) continue
      const prevReturned = saleItem.returned_quantity || 0
      const returnQty = Math.min(ri.quantity, saleItem.quantity - prevReturned)
      if (returnQty <= 0) continue

      // Atomically claim the return BEFORE restoring stock — a concurrent
      // duplicate request would otherwise restore stock twice. The conditional
      // update only succeeds if returned_quantity is still what we read.
      let claim = admin.from('sale_items')
        .update({ returned_quantity: prevReturned + returnQty })
        .eq('id', saleItem.id)
      claim = saleItem.returned_quantity == null
        ? claim.is('returned_quantity', null)
        : claim.eq('returned_quantity', saleItem.returned_quantity)
      const { data: claimedRows } = await claim.select('id')
      if (!claimedRows || claimedRows.length === 0) continue

      const rawValue = returnQty * parseFloat(saleItem.unit_price)
      totalRefundRaw += rawValue
      totalRefund += Math.round(rawValue * discountFactor)

      // Restore stock
      if (saleItem.product_id) {
        await adjustProductQuantity(admin, saleItem.product_id, vendor.id, returnQty)
      }

      // Restore FIFO cost layer for returned quantity
      if (saleItem.product_id && parseInt(saleItem.unit_cost || 0) > 0) {
        await admin.rpc('restore_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: saleItem.product_id,
          p_quantity: returnQty, p_unit_cost: parseInt(saleItem.unit_cost),
          p_received_at: new Date().toISOString().slice(0, 10),
        })
      }

      returnedDetails.push(saleItem.product_name + ' x' + returnQty)
      claimedReturns.push({ saleItemId: saleItem.id, quantity: returnQty })
    }

    if (totalRefund <= 0)
      return NextResponse.json({ error: 'Nothing to return' }, { status: 400 })

    // Transferred parts: the sending shop's mirrored sale takes the same return
    let sellThroughReturnNote = ''
    try {
      const mirrored = await returnSellThrough(admin, saleId, claimedReturns, vendor.callerUserId || null)
      if (mirrored.length > 0) sellThroughReturnNote = ` | Also returned on the sending shop's ${mirrored.join(', ')}`
    } catch (e: any) { sellThroughReturnNote = ` | ⚠️ Sending shop's invoice not adjusted: ${e?.message || e}` }

    // 2. Update sale totals
    const currentPaid = parseFloat(sale.paid_amount || 0)
    const currentTotal = parseFloat(sale.total)
    const currentBalance = parseFloat(sale.balance_due || 0)
    // Never refund more than the customer actually paid + owed (rounding guard)
    totalRefund = Math.min(totalRefund, currentPaid + currentBalance)
    // Refund reduces balance first (credit), then paid_amount (cash already received)
    const balanceReduction = Math.min(totalRefund, currentBalance)
    const paidReduction = Math.min(totalRefund - balanceReduction, currentPaid)
    const newBalanceDue = Math.max(0, currentBalance - balanceReduction)
    const newPaidAmount = Math.max(0, currentPaid - paidReduction)

    const returnedAt = new Date().toISOString()

    // The sale keeps the value it was sold for, and the return is counted in the
    // period it happened (owner, 2026-09-01).
    //
    // Reducing sale.total rewrote a closed month. Commission is paid on a
    // 25th–24th cycle: a sale of Rs.1,100,000 in the May cycle was paid on, then
    // a return five days into June silently rewrote May down to zero — and June,
    // where the return actually happened, showed nothing to offset it. Eleven
    // Sakura returns worth Rs.3,364,000 crossed a cycle that way, with no
    // mechanism that ever clawed any of it back.
    //
    // returned_amount is the column for this; it already existed for the
    // tax-invoice side, where gazette amounts must never move. And this is what
    // CLAUDE.md already requires of credit notes: reduce turnover in the period
    // ISSUED, not the original invoice period. Receipts now match that rule.
    //
    // What the customer owes still drops immediately — that is balance_due,
    // computed below from total minus what has been returned and paid.
    const salesUpdate: Record<string, any> = {
      paid_amount: newPaidAmount,
      balance_due: newBalanceDue,
      returned_amount: Math.round(parseFloat(sale.returned_amount || 0) + totalRefund),
      // A fully returned sale is not a void: it happened, and it is reversed in
      // the period the goods came back. Voiding it removed it from its own
      // month, which is the same retroactive rewrite by another name.
      payment_status: newBalanceDue > 0 ? 'partial' : 'paid',
      notes: (sale.notes || '') + '\nRETURN: ' + returnedAt + ' | ' + returnedDetails.join(', ') + ' | Rs.' + totalRefund.toLocaleString() + (refundMethod === 'advance' ? ' to advance' : ' cash refund') + (returnReason ? ' | Reason: ' + String(returnReason).slice(0, 200) : ''),
    }
    // total and subtotal are deliberately absent from this update.

    await admin.from('sales').update(salesUpdate).eq('id', saleId)

    // 3. Handle refund to customer
    // Always record payment entries for reporting — even if customer_id is null.
    // Advance balance update still requires a linked customer.
    if (totalRefund > 0) {
      if (sale.customer_id && refundMethod === 'advance') {
        const { data: customer } = await admin.from('customers').select('advance_balance').eq('id', sale.customer_id).eq('vendor_id', vendor.id).single()
        if (customer) {
          // Only add the portion that was actually paid (not the portion that just cancels outstanding debt)
          await admin.from('customers').update({
            advance_balance: parseFloat(customer.advance_balance || 0) + paidReduction
          }).eq('id', sale.customer_id)
        }
      }
      // Record refund payments for ALL portions (always, for audit + report visibility)
      // Cash/advance portion (money that needs to move back)
      if (paidReduction > 0) {
        await admin.from('payments').insert({
          created_by: vendor.callerUserId || null, sale_id: saleId, vendor_id: vendor.id, customer_id: sale.customer_id || null,
          amount: -paidReduction,
          payment_method: refundMethod === 'advance' ? 'advance' : 'cash',
          notes: 'RETURN: ' + returnedDetails.join(', ')
        })
      }
      // Credit portion (balance that was owed but now cancelled — no money moves)
      if (balanceReduction > 0) {
        await admin.from('payments').insert({
          created_by: vendor.callerUserId || null, sale_id: saleId, vendor_id: vendor.id, customer_id: sale.customer_id || null,
          amount: -balanceReduction,
          payment_method: 'credit_return',
          notes: 'RETURN (credit cancelled): ' + returnedDetails.join(', ')
        })
      }
    }

    return NextResponse.json({
      success: true,
      refundAmount: totalRefund,
      cashRefund: paidReduction,
      // The caller used this to know the sale had been voided. It no longer is:
      // a full return leaves the sale standing and reversed in its own period.
      fullyReturned: (await admin.from('sale_items').select('quantity, returned_quantity').eq('sale_id', saleId)).data?.every((i: any) => (i.returned_quantity || 0) >= i.quantity) ?? false,
      message: 'Returned: ' + returnedDetails.join(', ') + '. Total value: Rs.' + totalRefund.toLocaleString() + (paidReduction > 0 ? (refundMethod === 'advance' ? ` | Rs.${paidReduction.toLocaleString()} added to advance` : ` | Rs.${paidReduction.toLocaleString()} cash back`) : '') + sellThroughReturnNote
    })
  }

  if (action === 'create_draft') {
    const { customerId, customerName, customerPhone, items, notes, vehicleNo } = body
    if (!items || items.length === 0) return NextResponse.json({ error: 'No items' }, { status: 400 })

    // Same validation as create_sale — a negative quantity here would INCREASE
    // stock at the deduction step below.
    for (const item of items) {
      const q = Number(item.quantity)
      const p = Number(item.unitPrice ?? 0)
      if (!Number.isFinite(q) || q < 1) return NextResponse.json({ error: `Invalid quantity for "${item.productName || 'item'}"` }, { status: 400 })
      if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: `Invalid price for "${item.productName || 'item'}"` }, { status: 400 })
      item.quantity = Math.round(q)
      item.unitPrice = Math.round(p)
    }

    let resolvedCustomerId = customerId || null
    if (!resolvedCustomerId && customerName?.trim()) {
      if (customerPhone?.trim()) {
        const { data: existing } = await admin.from('customers').select('id')
          .eq('vendor_id', vendor.id).eq('phone', customerPhone.trim()).single()
        if (existing) resolvedCustomerId = existing.id
      }
      if (!resolvedCustomerId) {
        const { data: newCust } = await admin.from('customers').insert({
          vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,
        }).select().single()
        if (newCust) resolvedCustomerId = newCust.id
      }
    }

    // Assign a dedicated On Approval sequence number (e.g. SAK-OP-0001).
    // generateInvoiceNo skips '-OP-' numbers so the two sequences never collide.
    const subtotal = items.reduce((s: number, i: any) => s + (i.quantity * (i.unitPrice || 0)), 0)
    const draftNo = await generateDraftNo(vendor.id, vendor.name)

    const { data: draft, error } = await admin.from('sales').insert({
      created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
      invoice_no: draftNo, customer_name: customerName || 'Walk-in Customer',
      customer_phone: customerPhone || null, subtotal, discount: 0,
      total: subtotal, paid_amount: 0, balance_due: 0,
      payment_method: 'cash', payment_status: 'draft',
      vehicle_no: vehicleNo || null,
      notes: notes ? ('ON APPROVAL\n' + notes) : 'ON APPROVAL',
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const saleItems = items.map((item: any) => ({
      sale_id: draft.id, product_id: item.productId,
      product_name: item.productName, product_sku: item.productSku || null,
      quantity: item.quantity, unit_price: item.unitPrice || 0,
      unit_cost: item.unitCost || null, total: item.quantity * (item.unitPrice || 0),
    }))
    await admin.from('sale_items').insert(saleItems)

    // Reduce stock — items are physically leaving the shop
    for (const item of items) {
      if (item.productId) {
        await adjustProductQuantity(admin, item.productId, vendor.id, -item.quantity)
      }
    }

    return NextResponse.json({ success: true, draft, message: 'On Approval draft created — stock reserved' })
  }

  // Move a Rs.0 item from a finalized invoice back into an existing on-approval draft.
  // Stock is NOT touched — the item is still physically with the customer.
  if (action === 'move_to_approval') {
    const { saleId, saleItemId } = body
    const { data: sale } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    const item = (sale.items || []).find((i: any) => i.id === saleItemId)
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    if (parseFloat(item.unit_price || 0) !== 0) return NextResponse.json({ error: 'Only Rs.0 items can be moved to on-approval' }, { status: 400 })

    // Find the most recent open draft for this customer
    let targetDraftId: string | null = null
    let targetDraftNo: string | null = null
    if (sale.customer_id) {
      const { data: existing } = await admin.from('sales')
        .select('id, invoice_no').eq('vendor_id', vendor.id).eq('customer_id', sale.customer_id)
        .eq('payment_status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (existing) { targetDraftId = existing.id; targetDraftNo = existing.invoice_no }
    }

    // No existing draft — create one
    if (!targetDraftId) {
      const newDraftNo = await generateDraftNo(vendor.id, vendor.name)
      const { data: newDraft } = await admin.from('sales').insert({
        created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, customer_id: sale.customer_id,
        invoice_no: newDraftNo, customer_name: sale.customer_name, customer_phone: sale.customer_phone,
        subtotal: 0, discount: 0, total: 0, paid_amount: 0, balance_due: 0,
        payment_status: 'draft', notes: 'ON APPROVAL',
      }).select().single()
      if (newDraft) { targetDraftId = newDraft.id; targetDraftNo = newDraftNo }
    }

    if (!targetDraftId) return NextResponse.json({ error: 'Could not find or create draft' }, { status: 500 })

    // Re-parent the item — no stock change
    await admin.from('sale_items').update({ sale_id: targetDraftId }).eq('id', saleItemId)

    return NextResponse.json({ success: true, draftInvoiceNo: targetDraftNo, message: `Item moved to on-approval ${targetDraftNo}` })
  }

  if (action === 'return_draft_item') {
    // Return a single item from a draft (on-approval) — restore its stock and remove it.
    // If it was the last item, void the entire draft.
    const { saleId, saleItemId } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    const item = (draft.items || []).find((i: any) => i.id === saleItemId)
    if (!item) return NextResponse.json({ error: 'Item not found in draft' }, { status: 404 })

    // Restore stock for this item
    if (item.product_id) {
      await adjustProductQuantity(admin, item.product_id, vendor.id, item.quantity)
    }

    // Remove this item from the draft
    await admin.from('sale_items').delete().eq('id', saleItemId)

    // Check if any items remain
    const remainingItems = (draft.items || []).filter((i: any) => i.id !== saleItemId)
    if (remainingItems.length === 0) {
      // Last item — delete the draft entirely (no invoice was ever assigned, nothing to keep)
      await admin.from('sales').delete().eq('id', saleId)
      return NextResponse.json({ success: true, voided: true, message: item.product_name + ' returned — draft deleted (no items left)' })
    } else {
      // Update draft totals
      const newSubtotal = remainingItems.reduce((s: number, i: any) => s + parseFloat(i.total || 0), 0)
      await admin.from('sales').update({
        subtotal: newSubtotal, total: newSubtotal,
        notes: (draft.notes || '') + '\nITEM RETURNED: ' + item.product_name + ' ×' + item.quantity,
      }).eq('id', saleId)
      return NextResponse.json({ success: true, voided: false, message: item.product_name + ' ×' + item.quantity + ' returned — stock restored' })
    }
  }

  if (action === 'return_draft') {
    const { saleId } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    // Restore stock for all items
    for (const item of (draft.items || [])) {
      if (item.product_id) {
        await adjustProductQuantity(admin, item.product_id, vendor.id, item.quantity)
      }
    }

    // Delete the draft entirely — no invoice was ever assigned so nothing to archive
    await admin.from('sale_items').delete().eq('sale_id', saleId)
    await admin.from('sales').delete().eq('id', saleId)

    return NextResponse.json({ success: true, message: 'All items returned — draft deleted' })
  }

  if (action === 'cleanup_void_drafts') {
    // Cleanup: delete voided On Approval (-OP-) records with total=0 that were created
    // before the new delete-on-return behaviour. ONLY targets On Approval invoices —
    // never regular invoices (even if voided+total=0 after a full return).
    const { data: oldVoids } = await admin
      .from('sales')
      .select('id')
      .eq('vendor_id', vendor.id)
      .eq('payment_status', 'voided')
      .eq('total', 0)
      .ilike('invoice_no', '%-OP-%')
    if (oldVoids && oldVoids.length > 0) {
      const ids = oldVoids.map((s: any) => s.id)
      await admin.from('sale_items').delete().in('sale_id', ids)
      await admin.from('sales').delete().in('id', ids)
    }
    return NextResponse.json({ success: true, deleted: oldVoids?.length || 0 })
  }

  if (action === 'finalize_draft') {
    const {
      saleId, customerId: bodyCustomerId, useAdvance, items: finalItems, payments: paymentLines,
      discount, vehicleNo, mileageKm, notes, saleDate, customerName, customerPhone,
      // lk_tax fields (only present for WHEEL MART / lk_tax vendors)
      invoiceEntityId, customerAddress, customerTin, customerVatRegistered, customerIsInsurance,
      claimNo,
    } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    // Validate + normalise item inputs (same rules as create_sale)
    for (const fi of (finalItems || [])) {
      const q = Number(fi.quantity)
      const p = Number(fi.unitPrice ?? 0)
      if (!Number.isFinite(q) || q < 1) return NextResponse.json({ error: 'Invalid quantity on a line item' }, { status: 400 })
      if (!Number.isFinite(p) || p < 0) return NextResponse.json({ error: 'Invalid price on a line item' }, { status: 400 })
      fi.quantity = Math.round(q)
      fi.unitPrice = Math.round(p)
      if (!fi.id && !fi.productName) return NextResponse.json({ error: 'New line item is missing product details' }, { status: 400 })
    }

    // Reconcile the editable finalize cart against the stored draft:
    //  - existing items whose quantity changed → update the row + adjust stock by the delta
    //  - brand-new items (no sale_items id) → insert a row on the draft + deduct stock
    // Without this, quantity edits and added items were charged in the total but
    // never stored or stock-deducted.
    for (const fi of (finalItems || [])) {
      if (fi.id) {
        const orig = (draft.items || []).find((di: any) => di.id === fi.id)
        if (orig && orig.quantity !== fi.quantity) {
          if (orig.product_id) {
            // positive delta = more units leaving the shop
            await adjustProductQuantity(admin, orig.product_id, vendor.id, -(fi.quantity - orig.quantity))
          }
          await admin.from('sale_items').update({ quantity: fi.quantity }).eq('id', fi.id).eq('sale_id', saleId)
        }
      } else {
        const { data: newItem } = await admin.from('sale_items').insert({
          sale_id: saleId, product_id: fi.productId || null,
          product_name: fi.productName, product_sku: fi.productSku || null,
          quantity: fi.quantity, unit_price: fi.unitPrice,
          total: fi.quantity * fi.unitPrice,
          sscl_stream: fi.ssclStream || (fi.productId ? 'PART' : 'SVC'),
        }).select('id').single()
        if (!newItem) return NextResponse.json({ error: 'Failed to add new line item' }, { status: 500 })
        fi.id = newItem.id
        if (fi.productId) await adjustProductQuantity(admin, fi.productId, vendor.id, -fi.quantity)
      }
    }

    // ── lk_tax: resolve entity + document type (same rules as create_sale) ──
    const finalizeInvoiceMode = await getInvoiceMode(vendor.id)
    const finalizeIsLkTax = finalizeInvoiceMode === 'lk_tax' && !!invoiceEntityId
    let finalizeEntity: { id: string; invoice_mode: string; receipt_prefix: string; serial_qqqq: string } | null = null
    let finalizeDocType: 'receipt' | 'tax_invoice' = 'receipt'
    if (finalizeIsLkTax) {
      finalizeEntity = await getInvoiceEntity(invoiceEntityId) as any
      if (!finalizeEntity) return NextResponse.json({ error: 'Invoice entity not found' }, { status: 400 })
      finalizeDocType = finalizeEntity.invoice_mode === 'lk_tax' ? 'tax_invoice' : 'receipt'
      if (finalizeDocType === 'tax_invoice' && saleDate) {
        const sd = new Date(saleDate)
        const now = new Date()
        if (sd.getFullYear() !== now.getFullYear() || sd.getMonth() !== now.getMonth()) {
          return NextResponse.json({ error: 'Tax invoice date must be within the current month' }, { status: 400 })
        }
      }
    }
    const finalizeVatRate = finalizeIsLkTax ? await getVatRate(vendor.id) : 0

    /** Reserves serial + computes VAT split for a finalized lk_tax sale. */
    const buildLkTaxFields = async (total: number) => {
      const supplyDate = saleDate ? new Date(saleDate) : new Date()
      const serial = await reserveSerial(invoiceEntityId, finalizeEntity!, finalizeDocType, supplyDate)
      const vatAmount = Math.round(total * finalizeVatRate / (100 + finalizeVatRate))
      const fields: Record<string, any> = {
        invoice_entity_id: invoiceEntityId,
        document_type: finalizeDocType,
        receipt_no: serial.receiptNo,
        tax_serial: serial.taxSerial,
        net_amount: total - vatAmount,
        vat_amount: vatAmount,
        date_supply: supplyDate.toISOString().split('T')[0],
      }
      if (finalizeDocType === 'tax_invoice') {
        fields.customer_address = customerAddress?.trim() || null
        fields.customer_tin = (customerVatRegistered && customerTin?.trim()) ? customerTin.trim() : null
      }
      return { fields, invoiceNo: serial.invoiceNo }
    }

    let resolvedCustomerId = bodyCustomerId || draft.customer_id || null

    // Auto-create customer if cashier typed a brand-new name+phone at finalise
    // (mirrors create_sale / create_draft so finalize_draft doesn't produce orphan sales)
    if (!resolvedCustomerId && customerName?.trim()) {
      if (customerPhone?.trim()) {
        const { data: existing } = await admin.from('customers').select('id')
          .eq('vendor_id', vendor.id).eq('phone', customerPhone.trim()).maybeSingle()
        if (existing) resolvedCustomerId = existing.id
      }
      if (!resolvedCustomerId) {
        const { data: newCust } = await admin.from('customers').insert({
          vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,
        }).select().single()
        if (newCust) resolvedCustomerId = newCust.id
      }
    }

    // Pull canonical name/phone from the linked customer so the finalised invoice
    // shows the registered customer's full details — not "Walk-in" or a typo
    let canonicalCustomerName: string | null = null
    let canonicalCustomerPhone: string | null = null
    if (resolvedCustomerId) {
      const { data: linkedCust } = await admin.from('customers')
        .select('name, phone').eq('id', resolvedCustomerId).eq('vendor_id', vendor.id).maybeSingle()
      if (linkedCust) {
        canonicalCustomerName = linkedCust.name
        canonicalCustomerPhone = linkedCust.phone
      }
    }
    const finalCustomerName  = canonicalCustomerName  || customerName || draft.customer_name
    const finalCustomerPhone = canonicalCustomerPhone || customerPhone || draft.customer_phone

    // Snapshot / update customer address + TIN for tax invoices (mirrors create_sale)
    if (finalizeDocType === 'tax_invoice' && resolvedCustomerId) {
      const custPatch: any = {}
      if (customerAddress?.trim()) custPatch.address = customerAddress.trim()
      if (customerVatRegistered !== undefined) custPatch.vat_registered = customerVatRegistered
      if (customerTin?.trim() && customerVatRegistered) custPatch.tin = customerTin.trim()
      if (customerIsInsurance !== undefined) custPatch.is_insurance = !!customerIsInsurance
      if (Object.keys(custPatch).length > 0) {
        await admin.from('customers').update(custPatch).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
      }
    }

    // ── Partial finalization: peel confirmed items into a new invoice, leave draft intact ──
    const confirmedItems = (finalItems || []).filter((fi: any) => parseFloat(fi.unitPrice || 0) > 0)
    const pendingItems   = (finalItems || []).filter((fi: any) => parseFloat(fi.unitPrice || 0) === 0)

    if (confirmedItems.length === 0)
      return NextResponse.json({ error: 'No priced items to finalize. Enter a price for at least one item.' }, { status: 400 })

    if (pendingItems.length > 0) {
      // ── PARTIAL PATH: create a brand-new invoice for confirmed items only ──
      const partialSubtotal = confirmedItems.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0)
      const discountAmt = Math.min(partialSubtotal, Math.max(0, Math.round(Number(discount) || 0)))
      const partialTotal = Math.max(0, partialSubtotal - discountAmt)

      let invoiceNo: string
      let lkTaxFields: Record<string, any> = {}
      if (finalizeIsLkTax) {
        const lk = await buildLkTaxFields(partialTotal)
        invoiceNo = lk.invoiceNo
        lkTaxFields = lk.fields
      } else {
        invoiceNo = await generateInvoiceNo(vendor.id, vendor.name)
      }

      let customerAdvance = 0
      if (resolvedCustomerId) {
        const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', resolvedCustomerId).eq('vendor_id', vendor.id).single()
        customerAdvance = parseFloat(cust?.advance_balance || 0)
      }
      const cashPaid = (paymentLines || []).reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
      {
        const creditProblem = creditOnAccountProblem({ customerName: finalCustomerName, customerAdvance, total: partialTotal, cashPaid, useAdvance: !!useAdvance, acknowledged: !!body.acknowledgeCredit })
        if (creditProblem) return NextResponse.json(creditProblem, { status: 409 })
      }
      const advanceUsed = useAdvance && customerAdvance > 0 ? Math.min(customerAdvance, Math.max(0, partialTotal - cashPaid)) : 0
      const paidAmt = Math.min(partialTotal, cashPaid + advanceUsed)
      const balanceDue = Math.max(0, partialTotal - paidAmt)
      const pStatus = balanceDue > 0 && paidAmt > 0 ? 'partial' : balanceDue > 0 ? 'credit' : 'paid'
      const primaryMethod = paymentLines && paymentLines.length > 0
        ? paymentLines.sort((a: any, b: any) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0].method || 'cash'
        : (advanceUsed > 0 ? 'advance' : balanceDue > 0 ? 'credit' : 'cash')

      // Create the new real invoice
      const { data: newSale, error: newSaleErr } = await admin.from('sales').insert({
        created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
        invoice_no: invoiceNo,
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        subtotal: partialSubtotal, discount: discountAmt, total: partialTotal,
        paid_amount: paidAmt, balance_due: balanceDue,
        payment_status: pStatus, payment_method: primaryMethod,
        vehicle_no: vehicleNo || draft.vehicle_no,
      mileage_km: Number.isFinite(parseInt(mileageKm)) && parseInt(mileageKm) >= 0 ? parseInt(mileageKm) : draft.mileage_km,
        notes: notes || null,
        created_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
        ...lkTaxFields,
      }).select().single()
      if (newSaleErr || !newSale) {
        // Serial already minted — preserve it as a VOID row (gapless sequence).
        if (finalizeIsLkTax && lkTaxFields.tax_serial) {
          await admin.from('sales').insert({
            created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, invoice_no: invoiceNo, customer_name: finalCustomerName || 'VOID',
            subtotal: 0, discount: 0, total: 0, net_amount: 0, vat_amount: 0,
            paid_amount: 0, balance_due: 0, total_amount_due: 0,
            payment_method: 'cash', payment_status: 'voided', voided_at: new Date().toISOString(),
            invoice_entity_id: lkTaxFields.invoice_entity_id, document_type: lkTaxFields.document_type,
            tax_serial: lkTaxFields.tax_serial, receipt_no: lkTaxFields.receipt_no || null,
            notes: 'VOID — draft finalize failed, serial preserved: ' + (newSaleErr?.message || ''),
          }).then(() => {}, () => {})
        }
        return NextResponse.json({ error: newSaleErr?.message || 'Failed to create invoice' }, { status: 400 })
      }

      // Move confirmed sale_items to new invoice and update their prices
      for (const fi of confirmedItems) {
        if (!fi.id) continue
        await admin.from('sale_items').update({
          sale_id: newSale.id, unit_price: fi.unitPrice, total: fi.quantity * fi.unitPrice,
        }).eq('id', fi.id)
      }

      // FIFO cost consumption for items on this partial invoice
      const { data: confirmedSaleItems } = await admin
        .from('sale_items').select('id, product_id, quantity').eq('sale_id', newSale.id)
      for (const si of (confirmedSaleItems || [])) {
        if (!si.product_id) continue
        const { data: totalCost } = await admin.rpc('consume_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: si.product_id, p_quantity: si.quantity,
        })
        if (totalCost && totalCost > 0) {
          await admin.from('sale_items')
            .update({ unit_cost: Math.round(totalCost / si.quantity) })
            .eq('id', si.id)
        }
      }
      // Transferred parts sold here → the sending shop's sale (best effort)
      try {
        await recordSellThrough(admin, vendor.id, { id: newSale.id, invoice_no: invoiceNo, created_at: newSale.created_at || null }, confirmedSaleItems || [], vendor.callerUserId || null)
      } catch (e) { console.error('sell-through (partial finalize) failed', newSale.id, e) }

      // Record payments on new invoice
      for (const pl of (paymentLines || [])) {
        if (parseFloat(pl.amount) > 0) {
          await admin.from('payments').insert({
            created_by: vendor.callerUserId || null, sale_id: newSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
            amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
            bank_ref: pl.bankRef || null, cheque_number: pl.chequeNumber || null, cheque_date: pl.chequeDate || null,
          })
        }
      }
      if (advanceUsed > 0) {
        await admin.from('payments').insert({
          created_by: vendor.callerUserId || null, sale_id: newSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: advanceUsed, payment_method: 'advance', notes: 'Used from advance balance',
          source_method: resolvedCustomerId ? await resolveAdvanceSource(admin, vendor.id, resolvedCustomerId) : 'cash',
        })
        await admin.from('customers').update({ advance_balance: Math.max(0, customerAdvance - advanceUsed) }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
      }

      // Overpayment must not vanish — credit any excess cash to the customer's advance
      const partialExcess = Math.max(0, cashPaid - partialTotal)
      if (partialExcess > 0 && resolvedCustomerId) {
        const { data: custNow } = await admin.from('customers')
          .select('advance_balance').eq('id', resolvedCustomerId).eq('vendor_id', vendor.id).single()
        if (custNow) {
          await admin.from('customers')
            .update({ advance_balance: parseFloat(custNow.advance_balance || 0) + partialExcess })
            .eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
        }
      }

      // Update the original draft: remove confirmed items' prices, zero out totals
      await admin.from('sales').update({ subtotal: 0, total: 0, paid_amount: 0, balance_due: 0 }).eq('id', saleId)

      // Claim spine: the partial invoice carries the claim too (best-effort)
      if ((claimNo || customerIsInsurance) && resolvedCustomerId) {
        await linkSaleToClaim(admin, vendor.id, newSale.id, resolvedCustomerId, claimNo,
          { vehicleNo: vehicleNo || draft.vehicle_no || null, createdBy: null })
      }

      return NextResponse.json({
        success: true, sale: newSale,
        remainingDraft: { id: saleId, invoice_no: draft.invoice_no, pendingCount: pendingItems.length },
        message: `Invoice ${invoiceNo} created for ${confirmedItems.length} item(s). ${pendingItems.length} item(s) remain on approval as ${draft.invoice_no}.`,
      })
    }
    // ── FULL PATH (all items priced): existing behaviour below ──

    // Update each item with final negotiated price
    for (const fi of (finalItems || [])) {
      if (!fi.id) continue
      await admin.from('sale_items').update({
        unit_price: fi.unitPrice,
        total: fi.quantity * fi.unitPrice,
      }).eq('id', fi.id).eq('sale_id', saleId)
    }

    const subtotal = (finalItems || []).reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0)
    const discountAmt = Math.min(subtotal, Math.max(0, Math.round(Number(discount) || 0)))
    const total = Math.max(0, subtotal - discountAmt)

    // Check customer advance (same logic as create_sale)
    let customerAdvance = 0
    if (resolvedCustomerId) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', resolvedCustomerId).eq('vendor_id', vendor.id).single()
      customerAdvance = parseFloat(cust?.advance_balance || 0)
    }

    const cashPaid = (paymentLines || []).reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
    {
      const creditProblem = creditOnAccountProblem({ customerName: finalCustomerName, customerAdvance, total, cashPaid, useAdvance: !!useAdvance, acknowledged: !!body.acknowledgeCredit })
      if (creditProblem) return NextResponse.json(creditProblem, { status: 409 })
    }
    const advanceUsedForBill = useAdvance && customerAdvance > 0
      ? Math.min(customerAdvance, Math.max(0, total - cashPaid))
      : 0

    const paidForThisBill = Math.min(total, cashPaid + advanceUsedForBill)
    const billBalance = Math.max(0, total - paidForThisBill)
    const excessPayment = Math.max(0, (cashPaid + advanceUsedForBill) - total)

    let paymentStatus = 'paid'
    if (billBalance > 0 && paidForThisBill > 0) paymentStatus = 'partial'
    else if (billBalance > 0 && paidForThisBill === 0) paymentStatus = 'credit'

    const primaryMethod = paymentLines && paymentLines.length > 0
      ? paymentLines.sort((a: any, b: any) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0].method || 'cash'
      : (advanceUsedForBill > 0 ? 'advance' : billBalance > 0 ? 'credit' : 'cash')

    // Assign the real invoice number now (draft had none)
    let invoiceNo: string
    let fullLkTaxFields: Record<string, any> = {}
    if (finalizeIsLkTax) {
      const lk = await buildLkTaxFields(total)
      invoiceNo = lk.invoiceNo
      fullLkTaxFields = lk.fields
    } else {
      invoiceNo = await generateInvoiceNo(vendor.id, vendor.name)
    }

    // Stamp the finalization date (not draft creation date) so it lands in today's reports
    const { error: finalizeUpdateErr } = await admin.from('sales').update({
      invoice_no: invoiceNo,
      customer_id: resolvedCustomerId,
      subtotal, discount: discountAmt, total,
      paid_amount: paidForThisBill, balance_due: billBalance,
      payment_status: paymentStatus,
      payment_method: primaryMethod,
      vehicle_no: vehicleNo || draft.vehicle_no,
      notes: notes || draft.notes?.replace('ON APPROVAL\n', '').replace('ON APPROVAL', '').trim() || null,
      created_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
      customer_name: finalCustomerName,
      customer_phone: finalCustomerPhone,
      ...fullLkTaxFields,
    }).eq('id', saleId)
    if (finalizeUpdateErr) {
      // The draft row stayed a draft and the serial was already minted — don't
      // continue (stock/FIFO) on an unfinalised row, and preserve the serial as a
      // VOID placeholder so the gazette sequence stays gapless. Draft can be retried.
      if (finalizeIsLkTax && fullLkTaxFields.tax_serial) {
        await admin.from('sales').insert({
          created_by: vendor.callerUserId || null,
      vendor_id: vendor.id, invoice_no: invoiceNo, customer_name: finalCustomerName || 'VOID',
          subtotal: 0, discount: 0, total: 0, net_amount: 0, vat_amount: 0,
          paid_amount: 0, balance_due: 0, total_amount_due: 0,
          payment_method: 'cash', payment_status: 'voided', voided_at: new Date().toISOString(),
          invoice_entity_id: fullLkTaxFields.invoice_entity_id, document_type: fullLkTaxFields.document_type,
          tax_serial: fullLkTaxFields.tax_serial, receipt_no: fullLkTaxFields.receipt_no || null,
          notes: 'VOID — draft finalize failed, serial preserved: ' + finalizeUpdateErr.message,
        }).then(() => {}, () => {})
      }
      return NextResponse.json({ error: finalizeUpdateErr.message }, { status: 400 })
    }

    // Claim spine: the finalized invoice carries the claim (best-effort)
    if ((claimNo || customerIsInsurance) && resolvedCustomerId) {
      await linkSaleToClaim(admin, vendor.id, saleId, resolvedCustomerId, claimNo,
        { vehicleNo: vehicleNo || draft.vehicle_no || null, createdBy: null })
    }

    // FIFO cost consumption — consume cost layers for product items now that sale is finalized
    const draftProductItems = (draft.items || []).filter((i: any) => i.product_id)
    if (draftProductItems.length > 0) {
      const { data: finalizedItems } = await admin
        .from('sale_items').select('id, product_id, quantity').eq('sale_id', saleId)
      for (const si of (finalizedItems || [])) {
        if (!si.product_id) continue
        const { data: totalCost } = await admin.rpc('consume_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: si.product_id, p_quantity: si.quantity,
        })
        if (totalCost && totalCost > 0) {
          await admin.from('sale_items')
            .update({ unit_cost: Math.round(totalCost / si.quantity) })
            .eq('id', si.id)
        }
      }
      // Transferred parts sold here → the sending shop's sale (best effort)
      try {
        const { data: finalizedRow } = await admin.from('sales').select('created_at').eq('id', saleId).single()
        await recordSellThrough(admin, vendor.id, { id: saleId, invoice_no: invoiceNo, created_at: finalizedRow?.created_at || null }, finalizedItems || [], vendor.callerUserId || null)
      } catch (e) { console.error('sell-through (finalize) failed', saleId, e) }
    }

    // Record cash/cheque/bank payment lines
    for (const pl of (paymentLines || [])) {
      if (parseFloat(pl.amount) > 0) {
        await admin.from('payments').insert({
          created_by: vendor.callerUserId || null, sale_id: saleId, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
          bank_ref: pl.bankRef || null, cheque_number: pl.chequeNumber || null,
          cheque_date: pl.chequeDate || null,
        })
      }
    }

    // Record advance usage
    if (advanceUsedForBill > 0) {
      await admin.from('payments').insert({
        created_by: vendor.callerUserId || null, sale_id: saleId, vendor_id: vendor.id, customer_id: resolvedCustomerId,
        amount: advanceUsedForBill, payment_method: 'advance',
        source_method: resolvedCustomerId ? await resolveAdvanceSource(admin, vendor.id, resolvedCustomerId) : 'cash',
        notes: 'Used from advance balance',
      })
    }

    // Handle overpayment: apply to outstanding invoices → remaining to advance
    const settledInvoices: string[] = []
    let excessAppliedToOutstanding = 0
    if (resolvedCustomerId) {
      if (excessPayment > 0) {
        const { data: outstandingSales } = await admin
          .from('sales')
          .select('id, invoice_no, total, paid_amount, balance_due')
          .eq('vendor_id', vendor.id)
          .eq('customer_id', resolvedCustomerId)
          .gt('balance_due', 0)
          .neq('payment_status', 'voided')
          .neq('id', saleId)
          .order('created_at', { ascending: true })

        let remaining = excessPayment
        for (const oldSale of (outstandingSales || [])) {
          if (remaining <= 0) break
          const oldBalance = parseFloat(oldSale.balance_due)
          const applyAmount = Math.min(remaining, oldBalance)
          await admin.from('payments').insert({
            created_by: vendor.callerUserId || null, sale_id: oldSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
            amount: applyAmount, payment_method: 'settlement',
            notes: `Auto-applied from invoice ${draft.invoice_no}`,
          })
          const newOldPaid = parseFloat(oldSale.paid_amount) + applyAmount
          const newOldBalance = Math.max(0, oldBalance - applyAmount)
          await admin.from('sales').update({
            paid_amount: newOldPaid, balance_due: newOldBalance,
            payment_status: newOldBalance <= 0 ? 'paid' : 'partial',
          }).eq('id', oldSale.id)
          excessAppliedToOutstanding += applyAmount
          remaining -= applyAmount
          if (newOldBalance <= 0) settledInvoices.push(oldSale.invoice_no)
        }
        // Remaining excess + whatever advance wasn't used for the bill → new advance balance
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill) + remaining
        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
      } else {
        // No overpayment — just deduct the advance that was used
        if (advanceUsedForBill > 0) {
          const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
          await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId).eq('vendor_id', vendor.id)
        }
      }
    }

    // Update total_amount_due snapshot on the sale
    if (resolvedCustomerId) {
      const { data: allCustomerSales } = await admin
        .from('sales').select('balance_due')
        .eq('vendor_id', vendor.id).eq('customer_id', resolvedCustomerId)
        .neq('payment_status', 'voided').neq('payment_status', 'draft').gt('balance_due', 0)
      const totalAmountDue = (allCustomerSales || []).reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      await admin.from('sales').update({ total_amount_due: totalAmountDue }).eq('id', saleId)
    }

    // Re-fetch after all updates so total_amount_due is included
    const { data: finalizedSale } = await admin.from('sales').select('*, items:sale_items(*), payments:payments(*)').eq('id', saleId).single()

    let msg = `Invoice ${invoiceNo} finalized — ${paymentStatus}`
    if (advanceUsedForBill > 0) msg += ` | Rs.${advanceUsedForBill.toLocaleString()} from advance`
    if (excessAppliedToOutstanding > 0) msg += ` | Rs.${excessAppliedToOutstanding.toLocaleString()} applied to old invoices`
    if (settledInvoices.length > 0) msg += ` (cleared: ${settledInvoices.join(', ')})`

    return NextResponse.json({
      success: true, sale: finalizedSale,
      totalAmountDue: finalizedSale?.total_amount_due || 0,
      advanceUsed: advanceUsedForBill, appliedToOutstanding: excessAppliedToOutstanding,
      settledInvoices, message: msg,
    })
  }

  if (action === 'recalculate_amounts_due') {
    // Recalculates total_amount_due for every active invoice using a time-ordered
    // cumulative algorithm: each invoice gets the running sum of balance_due for
    // all of that customer's invoices up to and including its position (by created_at).
    //
    // Example for Sisil Motors (sorted oldest→newest):
    //   older invoices (389k outstanding)
    //   SAK-00178 (193k)  → total_amount_due = 389k + 193k = 582k  ✓
    //   SAK-00180 (125k)  → total_amount_due = 582k + 125k = 707k  ✓
    //   SAK-00181 ( 55k)  → total_amount_due = 707k +  55k = 762k  ✓
    //
    // This produces unique, progressive values per invoice rather than a single flat total.
    const { data: allSales } = await admin
      .from('sales').select('id, customer_id, balance_due, invoice_no')
      .eq('vendor_id', vendor.id)
      .neq('payment_status', 'voided')
      .neq('payment_status', 'draft')
      .order('invoice_no', { ascending: true })
    if (!allSales || allSales.length === 0) return NextResponse.json({ success: true, updated: 0 })

    // Group invoices by customer
    const customerSales: Record<string, any[]> = {}
    for (const s of allSales) {
      if (!s.customer_id) continue
      if (!customerSales[s.customer_id]) customerSales[s.customer_id] = []
      customerSales[s.customer_id].push(s)
    }

    // For each customer compute cumulative balance_due (oldest → newest), fire all updates in parallel
    const updatePromises: PromiseLike<any>[] = []
    let updated = 0
    for (const sales of Object.values(customerSales)) {
      let cumulative = 0
      for (const s of sales) {
        cumulative += parseFloat(s.balance_due || 0)
        updatePromises.push(admin.from('sales').update({ total_amount_due: cumulative }).eq('id', s.id))
        updated++
      }
    }
    await Promise.all(updatePromises)
    return NextResponse.json({ success: true, updated })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
