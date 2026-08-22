import type { SupabaseClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────────
// Promoting a proprietor receipt to a Pvt Ltd tax invoice
//
// A sale billed under the proprietorship can be re-issued as a full Pvt Ltd
// tax invoice within a window (30 days, owner rule 2026-08-22). It is the
// compliant direction — output VAT that was not declared becomes declared —
// but it is not free of consequences, and two of them are about NUMBERING.
//
// The gazette serial is YYMMM_QQQQ_XXXXX and the counter is per entity PER
// PERIOD, so the YYMMM comes from the DATE OF SUPPLY, not from the day the
// document is raised. Promote an August sale in September and it takes
// 26AUG_PART_000nn — correct for the supply, but issued after 26SEP serials
// already exist. The August sequence stays gapless; what breaks is the
// assumption that serial order matches issue order.
//
// Worse, and easy to miss: adding an invoice to a month whose VAT return has
// already gone means the return understated output VAT. That is not a
// numbering problem, it is an amended-return problem, and it is the one worth
// stopping for.
//
// Neither is a reason to refuse — a late tax invoice is a legitimate document.
// They are reasons to say plainly what will happen before it happens.
// ─────────────────────────────────────────────────────────────────────────────

export const PROMOTE_WINDOW_DAYS = 30

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** YYMMM period code a gazette serial would carry for this supply date. */
export function serialPeriod(supplyDate: string | Date): string {
  const d = typeof supplyDate === 'string' ? new Date(`${String(supplyDate).slice(0, 10)}T00:00:00+05:30`) : supplyDate
  return `${d.getFullYear().toString().slice(-2)}${MONTHS[d.getMonth()]}`
}

/** Sortable key for a YYMMM period, so 26AUG < 26SEP < 27JAN compares correctly. */
export function periodRank(period: string): number {
  const yy = parseInt(period.slice(0, 2), 10)
  const mi = MONTHS.indexOf(period.slice(2))
  return yy * 12 + (mi < 0 ? 0 : mi)
}

export type PromoteWarning = { code: string; text: string }

export type PromoteCheck = {
  eligible: boolean
  reason?: string
  /** Date that will be printed as BOTH Date of Invoice and Date of Supply. */
  supplyDate?: string
  /** The day the sale actually happened, kept visible so the override is seen. */
  originalSaleDate?: string
  /** The tax invoice whose date is being carried over, if there is one. */
  datedFrom?: { serial: string; date: string } | null
  ageDays?: number
  period?: string
  targetEntity?: { id: string; name: string; serial_qqqq: string }
  warnings: PromoteWarning[]
}

/**
 * The date a promoted invoice is stamped with — owner rule 2026-08-22.
 *
 * The date of the LAST tax invoice this entity issued, so the serial sequence
 * and the dates advance together with no step backwards. Date of Invoice and
 * Date of Supply are then set the same.
 *
 * The caller never back-dates past the sale itself — it takes the LATER of
 * this date and the day the sale happened, so an invoice can be carried
 * forward but can never claim a supply took place earlier than it did.
 *
 * Where the date is carried forward it differs from the day the goods changed
 * hands; the true sale timestamp stays on sales.created_at and promoted_at
 * records when the document was raised, so the real order of events remains
 * recoverable.
 *
 * Falls back to the sale's own date when the entity has issued nothing yet.
 */
export async function lastTaxInvoiceDate(
  admin: SupabaseClient,
  vendorId: string,
  entityId: string,
): Promise<{ serial: string; date: string } | null> {
  const { data } = await admin.from('sales')
    .select('tax_serial, date_supply, created_at')
    .eq('vendor_id', vendorId).eq('invoice_entity_id', entityId)
    .not('tax_serial', 'is', null)
  if (!data || data.length === 0) return null
  // "Last" means the highest serial issued, which is the one the next number
  // follows — not the latest date, which can lag behind it.
  const sorted = [...data].sort((a: any, b: any) => {
    const [pa, , na] = String(a.tax_serial).split('_')
    const [pb, , nb] = String(b.tax_serial).split('_')
    return (periodRank(pa) - periodRank(pb)) || (parseInt(na, 10) - parseInt(nb, 10))
  })
  const last: any = sorted[sorted.length - 1]
  return { serial: last.tax_serial, date: String(last.date_supply || last.created_at).slice(0, 10) }
}

/**
 * Can this sale be promoted, and what will it disturb if it is?
 *
 * Shared by the pre-flight check and the promotion itself, so the warning the
 * operator was shown is exactly the condition that was evaluated.
 */
export async function checkPromotable(
  admin: SupabaseClient,
  vendorId: string,
  saleId: string,
  today = new Date(),
): Promise<PromoteCheck> {
  const no = (reason: string): PromoteCheck => ({ eligible: false, reason, warnings: [] })

  const { data: sale } = await admin.from('sales')
    .select('id, invoice_no, receipt_no, tax_serial, document_type, payment_status, total, customer_id, customer_tin, date_supply, created_at, invoice_entity_id')
    .eq('id', saleId).eq('vendor_id', vendorId).single()
  if (!sale) return no('Sale not found')

  if (sale.tax_serial) return no(`${sale.tax_serial} is already a tax invoice`)
  if (sale.payment_status === 'voided') return no('This sale is voided')
  if (sale.payment_status === 'draft') return no('This sale is still a draft')

  const { data: fromEntity } = await admin.from('invoice_entities')
    .select('id, name, invoice_mode, branch').eq('id', sale.invoice_entity_id).single()
  if (!fromEntity) return no('This sale has no entity recorded')
  if (fromEntity.invoice_mode === 'lk_tax') return no(`${fromEntity.name} already issues tax invoices`)

  // VAT-registered customers are excluded deliberately (owner rule). A
  // backdated tax invoice lands in THEIR input-VAT claim for a period they may
  // have filed — that is their exposure to carry, not ours to create. They
  // should be given the Pvt Ltd invoice at the till instead.
  let customerIsVatReg = !!String(sale.customer_tin || '').trim()
  if (!customerIsVatReg && sale.customer_id) {
    const { data: cust } = await admin.from('customers')
      .select('vat_registered, tin').eq('id', sale.customer_id).maybeSingle()
    if (cust?.vat_registered || String(cust?.tin || '').trim()) customerIsVatReg = true
  }
  if (customerIsVatReg) {
    return no('This customer is VAT-registered — they must be given the Pvt Ltd tax invoice at the time of sale, not afterwards')
  }

  const originalSaleDate = String(sale.date_supply || sale.created_at).slice(0, 10)
  // Eligibility is judged on when the sale REALLY happened — the 30-day window
  // is about the age of the transaction, not the date we are about to stamp.
  const ageDays = Math.floor(
    (new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`).getTime()
      - new Date(`${originalSaleDate}T00:00:00Z`).getTime()) / 86_400_000
  )
  if (ageDays > PROMOTE_WINDOW_DAYS) {
    return no(`Sold ${ageDays} days ago — past the ${PROMOTE_WINDOW_DAYS}-day window`)
  }

  const { data: target } = await admin.from('invoice_entities')
    .select('id, name, serial_qqqq').eq('vendor_id', vendorId)
    .eq('invoice_mode', 'lk_tax').eq('branch', fromEntity.branch).maybeSingle()
  if (!target) return no(`No Pvt Ltd entity is set up for the ${fromEntity.branch} branch`)

  // The date carried over from the last tax invoice this entity issued, so the
  // serials and their dates advance together (owner rule). Everything below —
  // the serial's period, the warnings — follows from this, not from the day
  // the sale happened.
  const datedFrom = await lastTaxInvoiceDate(admin, vendorId, target.id)
  // Carry the previous invoice's date forward, but NEVER backwards past the
  // day the sale happened (owner exception): an invoice must not claim a
  // supply took place earlier than it did. Taking the later of the two keeps
  // the sequence non-decreasing without ever back-dating.
  const supplyDate = datedFrom && datedFrom.date > originalSaleDate
    ? datedFrom.date
    : originalSaleDate

  // ── What promoting will disturb ──
  const warnings: PromoteWarning[] = []
  const period = serialPeriod(supplyDate)
  const nowPeriod = serialPeriod(today)

  if (supplyDate !== originalSaleDate) {
    warnings.push({
      code: 'date_carried_over',
      text: `Both dates will read ${supplyDate}, carried forward from ${datedFrom!.serial}, so the numbering stays in date order. The sale actually happened on ${originalSaleDate} — that stays on the record but is not what the invoice will show.`,
    })
  }

  if (period !== nowPeriod) {
    warnings.push({
      code: 'cross_month',
      text: `The serial takes its period from the date of supply, so this becomes a ${period} invoice issued in ${nowPeriod}. The ${period} sequence stays gapless, but its numbers will no longer be in issue order.`,
    })
  }

  // A serial from an earlier period issued now sits behind serials already
  // issued for later periods — the thing that looks wrong in a ledger.
  const { data: existing } = await admin.from('sales')
    .select('tax_serial, created_at').eq('vendor_id', vendorId)
    .eq('invoice_entity_id', target.id).not('tax_serial', 'is', null)
  const later = (existing || []).filter((e: any) => {
    const p = String(e.tax_serial).split('_')[0]
    return periodRank(p) > periodRank(period)
  })
  if (later.length > 0) {
    warnings.push({
      code: 'after_later_serials',
      text: `${later.length} tax invoice${later.length !== 1 ? 's have' : ' has'} already been issued for a later period than ${period}. This one will be numbered behind them.`,
    })
  }

  if (periodRank(period) < periodRank(nowPeriod)) {
    warnings.push({
      code: 'reopens_filed_period',
      text: `This adds output VAT to ${period}. If that period's VAT return has already been filed, it will need amending — check before promoting.`,
    })
  }

  return {
    eligible: true, supplyDate, originalSaleDate, datedFrom, ageDays, period,
    targetEntity: { id: target.id, name: target.name, serial_qqqq: target.serial_qqqq },
    warnings,
  }
}
