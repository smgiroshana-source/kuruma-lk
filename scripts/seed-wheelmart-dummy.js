// Disposable dummy-data seeder for WHEEL MART (dev only — will be wiped before go-live).
// Generates internally-consistent tax invoices so reports/lists are populated.
const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8')
const get = k => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null }
const { createClient } = require('@supabase/supabase-js')
const sb = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'))

const VID = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503'
const ENTITY = '60c34238-9fe8-4c14-add5-a9466db5a8a4' // MacForce (Pvt) Ltd, lk_tax, PART
const MMM = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1))
const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const vatOf = t => Math.round(t * 18 / 118)

;(async () => {
  // 1) Seed selling prices (cost*1.3) on a batch of in-stock products
  const { data: prods } = await sb.from('products').select('id,sku,name,quantity,cost').eq('vendor_id', VID).gt('quantity', 3).gt('cost', 0).limit(16)
  const sellable = []
  for (const p of prods) {
    const price = Math.round(p.cost * 1.3)
    await sb.from('products').update({ price }).eq('id', p.id)
    sellable.push({ ...p, price })
  }
  console.log('Seeded prices on', sellable.length, 'products')

  // 2) Dummy customers (a couple VAT-registered)
  const custDefs = [
    { name: 'Lanka Logistics (Pvt) Ltd', phone: '0112345678', address: 'Colombo 03', vat_registered: true, tin: '123456789' },
    { name: 'Silva Motors', phone: '0719876543', address: 'Kandy', vat_registered: true, tin: '987654321' },
    { name: 'Perera Stores', phone: '0771122334', address: 'Galle', vat_registered: false, tin: null },
    { name: 'Fernando Transport', phone: '0765566778', address: 'Negombo', vat_registered: false, tin: null },
  ]
  const customers = []
  for (const c of custDefs) {
    const { data } = await sb.from('customers').insert({ vendor_id: VID, ...c, advance_balance: 0, require_vehicle_no: false }).select('id,name,phone,address,vat_registered,tin').single()
    customers.push(data)
  }
  // give one customer an advance
  await sb.from('customers').update({ advance_balance: 25000 }).eq('id', customers[0].id)
  console.log('Created', customers.length, 'customers')

  const SVC = ['Wheel Alignment', 'Tyre Fitting & Balancing', 'Puncture Repair', 'Labour Charge']
  const stockLeft = Object.fromEntries(sellable.map(p => [p.id, p.quantity]))

  async function consumeFifo(productId, qty) {
    const { data: layers } = await sb.from('cost_layers').select('id,quantity_remaining').eq('vendor_id', VID).eq('product_id', productId).gt('quantity_remaining', 0).order('received_at').order('created_at')
    let need = qty
    for (const L of (layers || [])) { if (need <= 0) break; const take = Math.min(need, L.quantity_remaining); await sb.from('cost_layers').update({ quantity_remaining: L.quantity_remaining - take }).eq('id', L.id); need -= take }
  }

  async function makeSale({ serial, year, month, day, n }) {
    const created = `2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T0${rnd(2,7)}:${String(rnd(0,59)).padStart(2,'0')}:00+00:00`
    const items = []
    // 1-2 product lines
    const nLines = rnd(1, 2)
    for (let i = 0; i < nLines; i++) {
      const p = pick(sellable)
      if (stockLeft[p.id] < 1) continue
      const q = Math.min(rnd(1, 2), stockLeft[p.id])
      stockLeft[p.id] -= q
      items.push({ product_id: p.id, product_name: p.name, product_sku: p.sku, quantity: q, unit_price: p.price, total: p.price * q, unit_cost: p.cost, sscl_stream: 'PART', returned_quantity: 0 })
    }
    if (!items.length) return null
    // ~40% get an SVC line
    if (Math.random() < 0.4) { const price = rnd(2, 8) * 1000; items.push({ product_id: null, product_name: pick(SVC), product_sku: null, quantity: 1, unit_price: price, total: price, unit_cost: null, sscl_stream: 'SVC', returned_quantity: 0 }) }
    const subtotal = items.reduce((s, i) => s + i.total, 0)
    const discount = Math.random() < 0.25 ? rnd(1, 5) * 500 : 0
    const total = subtotal - discount
    const vat = vatOf(total), net = total - vat
    // payment mix
    const r = Math.random()
    let paid, status
    if (r < 0.6) { paid = total; status = 'paid' }
    else if (r < 0.85) { paid = Math.round(total * 0.5); status = 'partial' }
    else { paid = 0; status = 'credit' }
    const balance = total - paid
    const cust = Math.random() < 0.75 ? pick(customers) : null

    const { data: sale, error } = await sb.from('sales').insert({
      vendor_id: VID, invoice_no: serial, tax_serial: serial, document_type: 'tax_invoice', invoice_entity_id: ENTITY,
      customer_id: cust?.id || null, customer_name: cust?.name || 'Walk-in Customer', customer_phone: cust?.phone || null,
      customer_address: cust?.address || null, customer_tin: (cust?.vat_registered ? cust.tin : null),
      subtotal, discount, total, net_amount: net, vat_amount: vat, paid_amount: paid, balance_due: balance, total_amount_due: balance,
      payment_method: 'cash', payment_status: status, returned_amount: 0, voided_at: null,
      date_supply: created.slice(0, 10), created_at: created,
    }).select('id').single()
    if (error) { console.log('sale err', serial, error.message); return null }
    for (const it of items) await sb.from('sale_items').insert({ sale_id: sale.id, ...it })
    for (const it of items) if (it.product_id) await consumeFifo(it.product_id, it.quantity)
    if (paid > 0) await sb.from('payments').insert({ sale_id: sale.id, vendor_id: VID, customer_id: cust?.id || null, amount: paid, payment_method: 'cash', created_at: created })
    return { id: sale.id, serial, total, vat, net, status, items: items.length }
  }

  const made = []
  // 26MAY: fresh sequence 00001..00010
  for (let i = 1; i <= 10; i++) { const r = await makeSale({ serial: `26MAY_PART_${String(i).padStart(5,'0')}`, month: 5, day: rnd(2, 28) }); if (r) made.push(r) }
  // 26JUN: continue 00006..00020 (00001-00005 already exist)
  for (let i = 6; i <= 20; i++) { const r = await makeSale({ serial: `26JUN_PART_${String(i).padStart(5,'0')}`, month: 6, day: rnd(2, 18) }); if (r) made.push(r) }

  // Deduct the sold stock from products
  for (const p of sellable) { const sold = p.quantity - stockLeft[p.id]; if (sold > 0) await sb.from('products').update({ quantity: stockLeft[p.id] }).eq('id', p.id) }

  // One VOID (done the correct way: voided_at + status), restore its stock
  if (made.length) {
    const v = made[made.length - 1]
    const { data: vit } = await sb.from('sale_items').select('product_id,quantity').eq('sale_id', v.id)
    await sb.from('sales').update({ payment_status: 'voided', voided_at: new Date().toISOString(), notes: 'VOID (dummy)' }).eq('id', v.id)
    for (const i of (vit || [])) if (i.product_id) { const { data: p } = await sb.from('products').select('quantity').eq('id', i.product_id).single(); await sb.from('products').update({ quantity: (p.quantity || 0) + i.quantity }).eq('id', i.product_id) }
    v.status = 'voided'
  }

  const live = made.filter(m => m.status !== 'voided')
  console.log('\n=== GENERATED ===')
  console.log('sales:', made.length, '(1 voided)')
  console.log('output VAT (live):', live.reduce((s, m) => s + m.vat, 0).toLocaleString())
  console.log('net sales (live):', live.reduce((s, m) => s + m.net, 0).toLocaleString())
  console.log('total (live):', live.reduce((s, m) => s + m.total, 0).toLocaleString())
})().catch(e => console.log('FATAL', e.message))
