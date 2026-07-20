#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GO-LIVE RESET — WHEEL MART
//
// Wipes all TRANSACTIONAL dummy data for the WHEEL MART vendor and resets
// every serial counter to zero, so the gazette sequence starts at 00001 with
// no possibility of the seeder-vs-counter collisions found in QA (duplicate
// 26JUN_PART_00006). Catalog master data is kept.
//
//   node scripts/golive-reset-wheelmart.mjs                  → DRY RUN (counts only)
//   node scripts/golive-reset-wheelmart.mjs --execute        → actually wipe
//   flags: --keep-customers   don't delete customers
//          --wipe-suppliers   also delete suppliers
//          --no-fifo-reseed   skip reseeding cost layers from products.cost
//
// KEEPS:   products, product_images, suppliers*, tax_config, invoice_entities,
//          vendor_settings, vendor_staff, vehicles
// DELETES: sales(+items), payments, credit_notes(+items), grns(+items),
//          cost_layers (reseeded from products.cost), cash_sessions, expenses,
//          supplier_invoices, supplier_payments, stock_movements, writeoffs,
//          customers*, invoice_sequences (gazette/receipt/CRN counters),
//          vendor_sequences (draft/invoice counters)
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const VENDOR_ID = '46f52c93-ee4b-4b28-bcd6-eb79ff11c503' // WHEEL MART
const EXECUTE = process.argv.includes('--execute')
const KEEP_CUSTOMERS = process.argv.includes('--keep-customers')
const WIPE_SUPPLIERS = process.argv.includes('--wipe-suppliers')
const FIFO_RESEED = !process.argv.includes('--no-fifo-reseed')

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const chunk = (a, n = 200) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out }

async function count(table, col = 'vendor_id', val = VENDOR_ID) {
  const { count: c, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
  return error ? `(table error: ${error.message})` : c
}
async function del(table, col = 'vendor_id', val = VENDOR_ID) {
  const { error } = await db.from(table).delete().eq(col, val)
  console.log(`  ${error ? '❌' : '🗑 '} ${table}: ${error ? error.message : 'deleted'}`)
}
async function delByIds(table, col, ids) {
  for (const c of chunk(ids)) {
    const { error } = await db.from(table).delete().in(col, c)
    if (error) { console.log(`  ❌ ${table}: ${error.message}`); return }
  }
  console.log(`  🗑  ${table}: deleted (${ids.length} parent refs)`)
}

console.log(`\n${EXECUTE ? '🔥 EXECUTING GO-LIVE RESET' : '🔍 DRY RUN (nothing will be deleted — add --execute to wipe)'} — WHEEL MART\n`)

// ── inventory of what exists ──
const { data: ents } = await db.from('invoice_entities').select('id, name').eq('vendor_id', VENDOR_ID)
const entityIds = (ents || []).map(e => e.id)
const { data: sales } = await db.from('sales').select('id').eq('vendor_id', VENDOR_ID)
const saleIds = (sales || []).map(s => s.id)
const { data: grns } = await db.from('grns').select('id').eq('vendor_id', VENDOR_ID)
const grnIds = (grns || []).map(g => g.id)
const { data: crns } = await db.from('credit_notes').select('id').eq('vendor_id', VENDOR_ID)
const crnIds = (crns || []).map(c => c.id)

console.log('Will delete:')
console.log(`  sales: ${saleIds.length} (+ their sale_items)`)
console.log(`  payments: ${await count('payments')}`)
console.log(`  credit_notes: ${crnIds.length} (+ items)`)
console.log(`  grns: ${grnIds.length} (+ items)`)
console.log(`  cost_layers: ${await count('cost_layers')}${FIFO_RESEED ? ' (reseeded from products.cost after wipe)' : ''}`)
console.log(`  cash_sessions: ${await count('cash_sessions')}`)
console.log(`  expenses: ${await count('expenses')}`)
console.log(`  supplier_invoices: ${await count('supplier_invoices')}`)
console.log(`  supplier_payments: ${await count('supplier_payments')}`)
console.log(`  stock_movements: ${await count('stock_movements')}`)
console.log(`  stock_writeoffs: ${await count('stock_writeoffs')}`)
console.log(`  customers: ${KEEP_CUSTOMERS ? 'KEPT (--keep-customers)' : await count('customers')}`)
console.log(`  suppliers: ${WIPE_SUPPLIERS ? await count('suppliers') : 'KEPT (default)'}`)
console.log(`  serial counters: invoice_sequences for ${entityIds.length} entities + vendor_sequences`)
console.log(`\nKeeping: ${await count('products')} products (+ images), tax_config, invoice_entities, vendor_settings, staff\n`)

if (!EXECUTE) { console.log('Dry run complete. Run with --execute when ready for go-live.\n'); process.exit(0) }

// ── the wipe, FK-safe order ──
if (crnIds.length) await delByIds('credit_note_items', 'credit_note_id', crnIds)
await del('credit_notes')
await del('payments')
if (saleIds.length) await delByIds('sale_items', 'sale_id', saleIds)
await del('sales')
await del('cost_layers')                 // before grns (grn_id FK)
if (grnIds.length) await delByIds('grn_items', 'grn_id', grnIds)
await del('grns')
await del('cash_sessions')
await del('expenses')
await del('supplier_invoices')
await del('supplier_payments')
await del('stock_movements')
{
  const { data: wo } = await db.from('stock_writeoffs').select('id').eq('vendor_id', VENDOR_ID)
  const woIds = (wo || []).map(w => w.id)
  if (woIds.length) await delByIds('stock_writeoff_items', 'writeoff_id', woIds)
  await del('stock_writeoffs')
}
if (!KEEP_CUSTOMERS) await del('customers')
if (WIPE_SUPPLIERS) await del('suppliers')

// ── reset EVERY serial counter — sequences must restart at 00001 ──
for (const eid of entityIds) {
  const { error } = await db.from('invoice_sequences').delete().eq('entity_id', eid)
  console.log(`  ${error ? '❌' : '🔢'} invoice_sequences (entity ${eid.slice(0, 8)}…): ${error ? error.message : 'reset'}`)
}
{
  const { error } = await db.from('vendor_sequences').delete().eq('vendor_id', VENDOR_ID)
  console.log(`  ${error ? '❌' : '🔢'} vendor_sequences: ${error ? error.message : 'reset'}`)
}

// ── reseed one clean FIFO layer per in-stock product from products.cost ──
if (FIFO_RESEED) {
  const { data: prods } = await db.from('products').select('id, quantity, cost').eq('vendor_id', VENDOR_ID).gt('quantity', 0)
  const seedable = (prods || []).filter(p => parseInt(p.cost) > 0)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  for (const c of chunk(seedable)) {
    const { error } = await db.from('cost_layers').insert(c.map(p => ({
      vendor_id: VENDOR_ID, product_id: p.id,
      quantity_received: p.quantity, quantity_remaining: p.quantity,
      unit_cost: parseInt(p.cost), received_at: today,
    })))
    if (error) { console.log(`  ❌ FIFO reseed: ${error.message}`); break }
  }
  console.log(`  🌱 FIFO reseeded: ${seedable.length} layers from products.cost (${(prods || []).length - seedable.length} in-stock products have no cost — receive those via GRN)`)
}

console.log('\n✅ Go-live reset complete. First tax invoice will be <YYMMM>_PART_00001.\n')
