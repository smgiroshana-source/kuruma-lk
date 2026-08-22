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
  supplyDate?: string
  ageDays?: number
  period?: string
  targetEntity?: { id: string; name: string; serial_qqqq: string }
  warnings: PromoteWarning[]
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

  const supplyDate = String(sale.date_supply || sale.created_at).slice(0, 10)
  const ageDays = Math.floor(
    (new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`).getTime()
      - new Date(`${supplyDate}T00:00:00Z`).getTime()) / 86_400_000
  )
  if (ageDays > PROMOTE_WINDOW_DAYS) {
    return no(`Sold ${ageDays} days ago — past the ${PROMOTE_WINDOW_DAYS}-day window`)
  }

  const { data: target } = await admin.from('invoice_entities')
    .select('id, name, serial_qqqq').eq('vendor_id', vendorId)
    .eq('invoice_mode', 'lk_tax').eq('branch', fromEntity.branch).maybeSingle()
  if (!target) return no(`No Pvt Ltd entity is set up for the ${fromEntity.branch} branch`)

  // ── What promoting will disturb ──
  const warnings: PromoteWarning[] = []
  const period = serialPeriod(supplyDate)
  const nowPeriod = serialPeriod(today)

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
    eligible: true, supplyDate, ageDays, period,
    targetEntity: { id: target.id, name: target.name, serial_qqqq: target.serial_qqqq },
    warnings,
  }
}
