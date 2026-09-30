/**
 * Staff loans (owner, 2026-09-23): money lent to a person and taken back from
 * salary a fixed instalment a month. Unlike an advance — which payroll
 * deducts in full on the next payday — a loan keeps a balance, and each PAID
 * payroll run records what came off it in staff_loan_repayments.
 *
 * Balance = amount − every repayment on record − any amount written off.
 * Repayments exist only for paid runs (written on payday, removed if the run
 * is reopened), so the balance is always what has actually come off the
 * person's pay. A write-off happens when someone leaves and their final pay
 * can't cover the loan (owner, 2026-09-30: decided case by case, mostly
 * written off); it too belongs to a payday and goes if that run is reopened.
 */

type Admin = any

export type LoanWithBalance = {
  id: string
  employee_id: string
  amount: number
  instalment: number
  date: string
  source: string
  note: string | null
  expense_id: string | null
  repaid: number
  written_off: number
  balance: number
  repayment_count: number
}

/** Every loan for the vendor (optionally a set of people), with what is left on it. */
export async function loansWithBalance(admin: Admin, vendorId: string, employeeIds?: string[]): Promise<LoanWithBalance[]> {
  let q = admin.from('staff_loans').select('*').eq('vendor_id', vendorId).order('date')
  if (employeeIds) {
    if (employeeIds.length === 0) return []
    q = q.in('employee_id', employeeIds)
  }
  const { data: loans, error } = await q
  // Before the migration runs the table doesn't exist — no loans, not a crash
  if (error || !loans || loans.length === 0) return []
  const { data: reps } = await admin.from('staff_loan_repayments')
    .select('loan_id, amount').in('loan_id', loans.map((l: any) => l.id))
  return loans.map((l: any) => {
    const mine = (reps || []).filter((r: any) => r.loan_id === l.id)
    const repaid = mine.reduce((s: number, r: any) => s + Math.round(Number(r.amount) || 0), 0)
    const writtenOff = Math.round(Number(l.written_off_amount) || 0)
    return {
      id: l.id, employee_id: l.employee_id, amount: Math.round(l.amount), instalment: Math.round(l.instalment),
      date: l.date, source: l.source, note: l.note, expense_id: l.expense_id,
      repaid, written_off: writtenOff, balance: Math.max(0, Math.round(l.amount) - repaid - writtenOff), repayment_count: mine.length,
    }
  })
}
