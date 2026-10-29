// ── What a printed or WhatsApp'd bill adds up to (2026-10-29) ────────────────
// A return on a receipt keeps sales.total as billed and records the value in
// sales.returned_amount (the Sales Report shows Returned on its own line). The
// bill templates dropped the returned lines but still printed sales.total as
// TOTAL — SAK-01131 listed Rs.192,000 of items under "TOTAL Rs.302,000" with
// nothing explaining the Rs.110,000 coolant that came back.
//
// Every bill print and bill message takes its totals from here, so the lines
// shown and the total shown can't disagree again. Tax invoices are left as
// issued: a finalized gazette invoice never changes; its returns are credit
// notes, a separate document.
//
// A "Wrong invoice" return (sale_returns.kind = 'rebill') is a billing mistake
// put right — no goods moved (owner, 2026-10-29: SAK-01131's coolant line was
// keyed by mistake, and "Subtotal 302,000 / Returned −110,000" on the
// customer's bill was wrong). The bill drops it as if the line was never
// there. Only goods that really came back (goods_back / faulty) print as
// Returned. The sale_returns rows, stock and the Sales Report keep the
// correction either way. With no returns rows loaded, everything shows as
// Returned (the safe side: nothing hidden).

const num = (v: unknown) => { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

export type BillTotals = { subtotal: number; discount: number; returned: number; total: number }

export function billTotals(sale: any): BillTotals {
  const billed = num(sale?.total)
  const discount = num(sale?.discount)
  let subtotal = num(sale?.subtotal) || billed + discount
  let returned = 0, corrected = 0
  if (sale?.document_type !== 'tax_invoice') {
    // returned_amount is what the return took off the bill; older rows only
    // carry returned_quantity on the lines
    returned = num(sale?.returned_amount) || (sale?.items || [])
      .reduce((t: number, i: any) => t + (Number(i.returned_quantity) || 0) * num(i.unit_price), 0)
    returned = Math.min(Math.max(0, returned), billed)
    const rows: any[] = Array.isArray(sale?.returns) ? sale.returns : []
    corrected = Math.min(returned, rows.filter(r => r?.kind === 'rebill').reduce((t, r) => t + num(r.amount), 0))
    returned -= corrected
    subtotal -= corrected
  }
  return { subtotal, discount, returned, total: billed - corrected - returned }
}

const rs = (n: number) => 'Rs.' + n.toLocaleString()

// The totals block of the receipt templates (their .totals / .total-row /
// .grand-total classes). Subtotal shows whenever something comes off it.
export function billTotalsHtml(sale: any): string {
  const t = billTotals(sale)
  const rows: string[] = []
  if (t.discount > 0 || t.returned > 0) rows.push(`<div class="total-row"><span>Subtotal</span><span>${rs(t.subtotal)}</span></div>`)
  if (t.discount > 0) rows.push(`<div class="total-row" style="color:#000"><span>Discount</span><span>-${rs(t.discount)}</span></div>`)
  if (t.returned > 0) rows.push(`<div class="total-row" style="color:#000"><span>Returned</span><span>-${rs(t.returned)}</span></div>`)
  rows.push(`<div class="total-row grand-total"><span>TOTAL</span><span>${rs(t.total)}</span></div>`)
  return `<div class="totals">${rows.join('')}</div>`
}

// The same totals as plain lines for a WhatsApp bill (caller joins them)
export function billTotalsLines(sale: any): string[] {
  const t = billTotals(sale)
  const lines = [`Subtotal: ${rs(t.subtotal)}`]
  if (t.discount > 0) lines.push(`Discount: -${rs(t.discount)}`)
  if (t.returned > 0) lines.push(`Returned: -${rs(t.returned)}`)
  lines.push(`*TOTAL: ${rs(t.total)}*`)
  return lines
}
