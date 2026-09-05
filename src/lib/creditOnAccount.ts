/**
 * A customer holding credit on account must not be billed in fresh cash.
 *
 * 5 Sep 2026, twice in one morning: a sale was returned with the refund
 * parked as advance (right — no cash was handed back), then the re-bill was
 * paid with a new cash line. The till's "Fill remaining" ignored the credit,
 * so the customer ended the day holding Rs.295,000 of credit he had never
 * been given, and the drawer expected Rs.295,000 that was never there.
 *
 * The rule, enforced here for every client: when a customer has credit,
 * either it is applied first and cash covers only the remainder, or the
 * operator explicitly acknowledges billing without it. Anything else is
 * refused with a message that says what to change.
 */
export interface CreditProblem {
  code: 'CREDIT_ON_ACCOUNT'
  error: string
  credit: number
  needed: number
}

export function creditOnAccountProblem(o: {
  customerName?: string | null
  customerAdvance: number
  total: number
  cashPaid: number
  useAdvance: boolean
  acknowledged: boolean
}): CreditProblem | null {
  const credit = Math.max(0, Math.round(o.customerAdvance || 0))
  if (credit <= 0 || o.acknowledged) return null
  const who = o.customerName?.trim() || 'This customer'
  const needed = Math.max(0, o.total - Math.min(credit, o.total))
  if (!o.useAdvance) {
    return {
      code: 'CREDIT_ON_ACCOUNT', credit, needed,
      error: `${who} holds Rs.${credit.toLocaleString()} credit on account. Apply it to this bill (tick "Use"), or confirm billing without it.`,
    }
  }
  if (o.cashPaid > needed) {
    return {
      code: 'CREDIT_ON_ACCOUNT', credit, needed,
      error: `Too much cash entered. Rs.${credit.toLocaleString()} credit covers this bill first — only Rs.${needed.toLocaleString()} is due in cash/bank, but Rs.${Math.round(o.cashPaid).toLocaleString()} was entered. Reduce the payment lines.`,
    }
  }
  return null
}
