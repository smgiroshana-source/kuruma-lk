// ─────────────────────────────────────────────────────────────────────────────
// Spare parts sales — WHEEL MART (owner, 2026-09-27)
//
// Every part sold from stock EXCEPT tyres, tubes & flaps and consumables —
// the Profit Report's "Spare parts" line of trade, item by item and by
// product category (Body Parts, Lighting, Hybrid & EV…). Same money rules as
// the Profit Report: VAT is stripped only on a tax invoice; returned
// quantities are left out; a part with no cost (most body parts are
// deliberately not cost-tracked) is excluded from profit, never given cost 0.
// Sales to the shop's own workshop are totalled separately.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'
import { netStockCost } from '@/lib/netCost'
import { netOfVat } from '@/lib/margin'

const lkStartOfDay = (d: string) => `${d}T00:00:00+05:30`
const lkEndOfDay = (d: string) => `${d}T23:59:59+05:30`

export async function sparePartsSales(admin: any, vendorId: string, fromStr: string, toStr: string) {
  const vendor = { id: vendorId }
  // Report heading — same source as the Profit Report
  const [{ data: settings }, { data: vrow }] = await Promise.all([
    admin.from('vendor_settings').select('invoice_title').eq('vendor_id', vendorId).maybeSingle(),
    admin.from('vendors').select('name').eq('id', vendorId).maybeSingle(),
  ])
  const { data: cfgSp } = await admin.from('tax_config')
    .select('value').eq('vendor_id', vendor.id).eq('key', 'vat_rate').maybeSingle()
  const spVatRate = cfgSp?.value != null ? parseFloat(cfgSp.value) : 18

  const products = await fetchAllRows((f, t) => admin.from('products')
    .select('id, sku, name, category, product_type, make, model, model_code, cost, cost_includes_vat, cost_vat_rate')
    .eq('vendor_id', vendor.id).order('id').range(f, t))
  const isSpare = (p: any) => p && p.product_type !== 'tyre' && p.product_type !== 'consumable' && p.category !== 'Wheels & Tires'
  const prodById = new Map(products.map((p: any) => [p.id, p]))
  const prodBySku = new Map(products.filter((p: any) => p.sku).map((p: any) => [p.sku, p]))

  const sales = await fetchAllRows((f, t) => admin.from('sales')
    .select('id, invoice_no, tax_serial, document_type, created_at, customer_name, vehicle_no')
    .eq('vendor_id', vendor.id).neq('payment_status', 'voided').neq('payment_status', 'draft')
    .gte('created_at', lkStartOfDay(fromStr)).lte('created_at', lkEndOfDay(toStr))
    .order('id').range(f, t))
  const saleById = new Map(sales.map((s: any) => [s.id, s]))
  const items = sales.length ? await fetchAllByIds(sales.map((s: any) => s.id), (ids, f, t) => admin.from('sale_items')
    .select('sale_id, product_id, product_sku, product_name, quantity, returned_quantity, unit_price, unit_cost')
    .in('sale_id', ids).order('id').range(f, t)) : []

  // The workshop's own account — same list the dashboard keeps out of
  // customer credit (api/vendor/data)
  const INTERNAL = ['macforce auto engineering']
  const rows: any[] = []
  for (const it of items) {
    const p = (it.product_id && prodById.get(it.product_id)) || (it.product_sku && prodBySku.get(it.product_sku)) || null
    if (!isSpare(p)) continue
    const qty = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0)
    if (qty <= 0) continue
    const s = saleById.get(it.sale_id)
    const gross = qty * (Number(it.unit_price) || 0)
    const revenue = s.document_type === 'tax_invoice' ? netOfVat(gross, spVatRate) : gross
    const snap = it.unit_cost != null && Number(it.unit_cost) > 0 ? netStockCost(Number(it.unit_cost), p, spVatRate) : null
    const unitCost = snap ?? (Number(p.cost) > 0 ? netStockCost(Number(p.cost), p, spVatRate) : null)
    const cost = unitCost != null ? Math.round(qty * unitCost) : null
    rows.push({
      date: new Date(s.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }),
      invoice: s.tax_serial || s.invoice_no, docType: s.document_type || null,
      category: p.category || 'Other', sku: it.product_sku || p.sku || '', item: it.product_name || p.name,
      vehicle: [p.make, p.model, p.model_code].filter(Boolean).join(' '), vehicleNo: s.vehicle_no || '',
      customer: s.customer_name || 'Walk-in Customer',
      workshop: INTERNAL.includes(String(s.customer_name || '').trim().toLowerCase()),
      qty, price: Number(it.unit_price) || 0, revenue, cost,
      profit: cost != null ? revenue - cost : null,
    })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.invoice).localeCompare(String(b.invoice)))

  const blank = () => ({ lines: 0, units: 0, revenue: 0, costedRevenue: 0, cost: 0, profit: 0, noCostRevenue: 0 })
  const add = (acc: any, r: any) => {
    acc.lines++; acc.units += r.qty; acc.revenue += r.revenue
    if (r.cost != null) { acc.costedRevenue += r.revenue; acc.cost += r.cost; acc.profit += r.profit }
    else acc.noCostRevenue += r.revenue
  }
  const totals = blank(), workshop = blank()
  const byCat = new Map<string, any>()
  for (const r of rows) {
    add(totals, r)
    if (r.workshop) add(workshop, r)
    if (!byCat.has(r.category)) byCat.set(r.category, { category: r.category, ...blank() })
    add(byCat.get(r.category), r)
  }
  const pct = (a: any) => a.costedRevenue > 0 ? Math.round((a.profit / a.costedRevenue) * 100) : null

  return {
    from: fromStr, to: toStr, vatRate: spVatRate,
    entity: settings?.invoice_title || vrow?.name || '',
    rows,
    byCategory: [...byCat.values()].map(c => ({ ...c, marginPct: pct(c) })).sort((a, b) => b.revenue - a.revenue),
    totals: { ...totals, marginPct: pct(totals) },
    workshop,
  }
}
