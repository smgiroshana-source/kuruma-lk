// ─────────────────────────────────────────────────────────────────────────────
// Item sales — WHEEL MART (owner, 2026-09-28)
//
// Every item sold in a date range — wheel alignment, patches, N2, tyres,
// parts — with quantity, how many bills it was on, and sales. Stock items are
// grouped by part number; typed service lines by their name, ignoring case
// and extra spaces ("Wheel alignment" and "Wheel Alignment " are one line;
// "N2" and "Air / nitrogen fill" stay two, because they are named differently).
// Returned quantities are left out; voided and draft bills are not sales.
// `billed` is what the customers paid; `net` takes VAT out of tax-invoice lines
// only (a receipt carries no VAT) — the same figure the Profit Report uses.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchAllRows, fetchAllByIds } from '@/lib/fetchAll'
import { netOfVat } from '@/lib/margin'

// Typed names that are the same service as a quick item (owner, 2026-09-28:
// "merge N2 into Air / nitrogen fill"). Lower-case, spaces collapsed.
const SAME_AS: Record<string, string> = {
  'n2': 'Air / nitrogen fill', 'n2 fill': 'Air / nitrogen fill',
  'nitrogen': 'Air / nitrogen fill', 'nitrogen fill': 'Air / nitrogen fill', 'air fill': 'Air / nitrogen fill',
}

const lkStartOfDay = (d: string) => `${d}T00:00:00+05:30`
const lkEndOfDay = (d: string) => `${d}T23:59:59+05:30`

export type ItemSalesRow = {
  key: string; name: string; sku: string; kind: 'stock' | 'service'; category: string
  qty: number; bills: number; billed: number; net: number
}

export async function itemSales(admin: any, vendorId: string, fromStr: string, toStr: string) {
  const { data: cfg } = await admin.from('tax_config')
    .select('value').eq('vendor_id', vendorId).eq('key', 'vat_rate').maybeSingle()
  const vatRate = cfg?.value != null ? parseFloat(cfg.value) : 18

  const sales = await fetchAllRows((f, t) => admin.from('sales')
    .select('id, document_type')
    .eq('vendor_id', vendorId).neq('payment_status', 'voided').neq('payment_status', 'draft')
    .gte('created_at', lkStartOfDay(fromStr)).lte('created_at', lkEndOfDay(toStr))
    .order('id').range(f, t))
  const docType = new Map(sales.map((s: any) => [s.id, s.document_type]))
  const items = sales.length ? await fetchAllByIds(sales.map((s: any) => s.id), (ids, f, t) => admin.from('sale_items')
    .select('sale_id, product_id, product_sku, product_name, quantity, returned_quantity, unit_price')
    .in('sale_id', ids).order('id').range(f, t)) : []

  const products = await fetchAllRows((f, t) => admin.from('products')
    .select('id, sku, name, category').eq('vendor_id', vendorId).order('id').range(f, t))
  const prodById = new Map(products.map((p: any) => [p.id, p]))
  const prodBySku = new Map(products.filter((p: any) => p.sku).map((p: any) => [p.sku, p]))

  type Acc = ItemSalesRow & { saleIds: Set<string>; names: Map<string, number> }
  const acc = new Map<string, Acc>()
  for (const it of items) {
    const qty = (Number(it.quantity) || 0) - (Number(it.returned_quantity) || 0)
    if (qty <= 0) continue
    const p = (it.product_id && prodById.get(it.product_id)) || (it.product_sku && prodBySku.get(it.product_sku)) || null
    const stock = !!(it.product_sku || p)
    const typed = String(it.product_name || p?.name || '—').trim().replace(/\s+/g, ' ')
    const rawName = !(it.product_sku || p) ? (SAME_AS[typed.toLowerCase()] || typed) : typed
    const key = stock ? `sku:${it.product_sku || p?.sku || p?.id}` : `svc:${rawName.toLowerCase()}`
    const billed = qty * (Number(it.unit_price) || 0)
    const net = docType.get(it.sale_id) === 'tax_invoice' ? netOfVat(billed, vatRate) : billed
    let a = acc.get(key)
    if (!a) {
      a = { key, name: rawName, sku: stock ? (it.product_sku || p?.sku || '') : '', kind: stock ? 'stock' : 'service',
            category: stock ? (p?.category || 'Other') : 'Services & labour',
            qty: 0, bills: 0, billed: 0, net: 0, saleIds: new Set(), names: new Map() }
      acc.set(key, a)
    }
    a.qty += qty; a.billed += billed; a.net += net
    a.saleIds.add(it.sale_id)
    a.names.set(rawName, (a.names.get(rawName) || 0) + qty)
  }

  const rows: ItemSalesRow[] = [...acc.values()].map(a => ({
    key: a.key, sku: a.sku, kind: a.kind, category: a.category,
    // A typed line shows the spelling used most often
    name: a.kind === 'service' ? [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0] : a.name,
    qty: a.qty, bills: a.saleIds.size, billed: Math.round(a.billed), net: Math.round(a.net),
  })).sort((x, y) => y.billed - x.billed)

  return {
    from: fromStr, to: toStr, vatRate,
    rows,
    totals: {
      items: rows.length,
      qty: rows.reduce((t, r) => t + r.qty, 0),
      billed: rows.reduce((t, r) => t + r.billed, 0),
      net: rows.reduce((t, r) => t + r.net, 0),
      bills: sales.length,
    },
  }
}
