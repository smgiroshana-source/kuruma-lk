// Expected cash in the drawer for one session, and re-deriving it after the
// fact. Shared so that ANY route which moves cash (expenses, staff advances,
// corrections) can leave the session arithmetic correct — a payment recorded
// by one screen must not leave another screen's variance wrong.

export async function computeExpected(admin: any, vendorId: string, session: any) {
  const sessionDate: string = session.session_date
  const openingBal = parseInt(session.opening_balance || 0)

  const dateStart = `${sessionDate}T00:00:00+05:30`
  const dateEnd = `${sessionDate}T23:59:59.999+05:30`
  const { data: payRows } = await admin
    .from('payments')
    .select('amount')
    .eq('vendor_id', vendorId)
    .eq('payment_method', 'cash')
    .gte('created_at', new Date(dateStart).toISOString())
    .lte('created_at', new Date(dateEnd).toISOString())
  const cashSales = Math.round((payRows || []).reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0))

  const { data: expenseRows } = await admin
    .from('expenses')
    .select('amount')
    .eq('vendor_id', vendorId)
    .eq('expense_date', sessionDate)
    .eq('payment_method', 'cash')
  const cashExpenses = (expenseRows || []).reduce((s: number, e: any) => s + parseInt(e.amount || 0), 0)

  // Cash handed to suppliers leaves the same drawer — without this a cash
  // supplier payment shows up as a shortage at close.
  const { data: supPayRows } = await admin
    .from('supplier_payments')
    .select('amount')
    .eq('vendor_id', vendorId)
    .eq('payment_date', sessionDate)
    .eq('method', 'cash')
  const cashSupplierPayments = (supPayRows || []).reduce((s: number, p: any) => s + parseInt(p.amount || 0), 0)

  const adjIn = parseInt(session.adjustment_in || 0)
  const adjOut = parseInt(session.adjustment_out || 0)

  return {
    cashSales, cashExpenses, cashSupplierPayments, adjIn, adjOut,
    expectedCash: openingBal + cashSales - cashExpenses - cashSupplierPayments + adjIn - adjOut,
  }
}

// Re-derive expected cash (and the variance, if the day is already counted)
// for the session covering `date`. Returns null when there is no session for
// that day — the money is still recorded, there is simply no drawer to update.
export async function recomputeSessionForDate(admin: any, vendorId: string, date: string) {
  const { data: session } = await admin
    .from('cash_sessions')
    .select('*')
    .eq('vendor_id', vendorId)
    .eq('session_date', date)
    .maybeSingle()
  if (!session) return null

  const { expectedCash, cashExpenses } = await computeExpected(admin, vendorId, session)
  const patch: any = { expected_cash: expectedCash, cash_expenses: cashExpenses }
  if (session.closing_balance != null) {
    patch.variance = parseInt(session.closing_balance) - expectedCash
    // A late entry that squares the day clears any earlier "accepted" flag
    if (patch.variance === 0) { patch.variance_accepted = false; patch.variance_reason = null }
  }
  await admin.from('cash_sessions').update(patch).eq('id', session.id).eq('vendor_id', vendorId)
  return { sessionId: session.id, ...patch }
}
