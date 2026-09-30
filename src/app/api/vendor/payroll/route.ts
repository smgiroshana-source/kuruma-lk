import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'
import { PAYROLL_FIRST_CYCLE_START } from '@/lib/payrollStart'
import { loansWithBalance, type LoanWithBalance } from '@/lib/staffLoans'
import { refreshDraftLines } from '@/lib/payrollDraft'

// ─────────────────────────────────────────────────────────────────────────────
// Monthly payroll run — WHEEL MART, owner only.
//
// GET  ?period=YYYY-MM  (the month the 25th→24th cycle ends / is paid in)
//                        → the saved run if there is one, otherwise a fresh
//                         proposal computed from pay items, attendance and
//                         the advances each person has taken.
// POST save_draft       → store the run as edited (nothing hits the books yet)
// POST mark_paid        → post one salaries expense per person, settle their
//                         advances, and reconcile the drawer for that day
// POST reopen / delete  → owner unwinding a mistake (paid runs unwind fully)
//
// Salaries are owner-only data throughout: a manager never receives this.
// ─────────────────────────────────────────────────────────────────────────────

async function getOwner() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id, email: user.email || '' }
  return null
}

const r0 = (n: number) => Math.round(Number(n) || 0)
const rsText = (n: number) => 'Rs.' + r0(n).toLocaleString('en-US')

// WHEEL MART pays salary for a 25th → 24th cycle (owner, 2026-08-24): period
// "2026-08" means 25 Jul – 24 Aug, paid ~25 Aug. The period key is the month
// the cycle ENDS in (= the month it is paid in), so "from April" on a raise
// means the cycle 25 Mar – 24 Apr. Attendance, proration, daily allowances
// and the advance cutoff all use these bounds.
function cycleBounds(period: string) {
  const [y, m] = period.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return { from: `${py}-${String(pm).padStart(2, '0')}-25`, to: `${period}-24` }
}

// "25 Jul – 24 Aug 2026" — for payslips and the expense line, so nobody has
// to remember what a period key means.
function cycleLabel(period: string) {
  const { from, to } = cycleBounds(period)
  const f = new Date(from + 'T00:00:00')
  const t = new Date(to + 'T00:00:00')
  const d = (x: Date, y: boolean) => x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}) })
  return `${d(f, f.getFullYear() !== t.getFullYear())} – ${d(t, true)}`
}

// How much of a day this component pays when the day was worked as a half day
const halfFactor = (policy: string) => (policy === 'full' ? 1 : policy === 'none' ? 0 : 0.5)

// ── The proposal ────────────────────────────────────────────────────────────
// Everything here is a starting point the owner can edit before saving: the
// system knows attendance and rates, it cannot know how many tyre repairs
// someone did or what the workshop's profit was.
function proposeLine(emp: any, items: any[], att: any[], advances: any[], loans: LoanWithBalance[] = [], leftOn: string | null = null) {
  // Leaving in this cycle (owner, 2026-09-30): the final settlement. Only the
  // days up to the leaving date count, monthly pay is monthly ÷ 25 × days
  // worked (the Profit Report's rule — an ordinary line the owner can change),
  // and the whole loan balance is proposed, as far as the pay covers it.
  if (leftOn) att = att.filter((a: any) => !a.date || a.date <= leftOn)
  const present = att.filter(a => a.status === 'present').length
  const half = att.filter(a => a.status === 'half').length
  const absent = att.filter(a => a.status === 'absent').length
  const marked = present + half + absent
  const payableDays = present + half * 0.5

  const components: any[] = []
  for (const it of items) {
    const rate = Number(it.amount) || 0
    const base = { kind: it.kind, label: it.label, unit: it.unit, period: it.period }

    if (it.kind === 'epf') {
      // A deduction. Percent is taken off the base salary, not the whole gross,
      // which is how EPF is actually computed.
      components.push({ ...base, qty: 1, rate, amount: 0, isDeduction: true, needsInput: it.unit === 'percent' })
      continue
    }

    if (it.period === 'daily') {
      // Allowances paid per day worked, with the half-day treated per its rule
      const qty = present + half * halfFactor(it.half_day_policy)
      components.push({ ...base, qty, rate, amount: r0(rate * qty) })
      continue
    }

    if (it.period === 'per_event') {
      // Commissions: the count is the owner's to enter — nothing tracks it yet
      components.push({ ...base, qty: 0, rate, amount: 0, needsInput: true })
      continue
    }

    // Monthly. A percent item (profit share) has no base to apply until the
    // owner says what the profit was, so it waits for input.
    if (it.unit === 'percent') {
      components.push({ ...base, qty: 1, rate, amount: 0, needsInput: true })
      continue
    }

    if (leftOn) {
      components.push({ ...base, qty: 1, rate, amount: r0(rate / 25 * payableDaysFor(present, half, it.half_day_policy)), prorated: true })
      continue
    }

    // Monthly salary is a FIXED amount (owner, 2026-08-24): attendance is
    // information for the owner, never an automatic deduction. Holidays stay
    // unmarked, normal leave is paid, and marking someone absent changes the
    // day counts shown — not the money. When leave has gone too far, the
    // owner types the cut into the "Leave / other deduction" line (net pay
    // only) or edits the base directly (which also lowers percentage EPF).
    components.push({ ...base, qty: 1, rate, amount: r0(rate) })
  }

  // EPF on a percentage takes the base salary as computed above
  const baseEarned = components.filter(c => c.kind === 'base').reduce((s, c) => s + c.amount, 0)
  for (const c of components) {
    if (c.kind === 'epf' && c.unit === 'percent') { c.amount = r0(baseEarned * c.rate / 100); c.needsInput = false }
    else if (c.kind === 'epf') c.amount = r0(c.rate)
  }

  // Standing manual deduction — zero unless the owner types one in. This is
  // the ONLY road from attendance to money, and a person drives it.
  if (items.length > 0) {
    components.push({
      kind: 'other', label: 'Leave / other deduction', unit: 'cash', period: 'monthly',
      qty: 1, rate: 0, amount: 0, isDeduction: true,
    })
  }

  // Loan repayments: the instalment, or what's left if that's less. The owner
  // can lower it or type 0 to skip a month — the balance just waits. On
  // payday what's on this line is what comes off the loan.
  for (const loan of loans) {
    if (loan.balance <= 0) continue
    components.push({
      kind: 'loan', label: 'Loan repayment', unit: 'cash', period: 'monthly',
      qty: 1, rate: loan.instalment, amount: leftOn ? loan.balance : Math.min(loan.instalment, loan.balance), isDeduction: true,
      loan_id: loan.id, balance: loan.balance, ...(leftOn ? { final: true } : {}),
    })
  }

  const gross = components.filter(c => !c.isDeduction).reduce((s, c) => s + c.amount, 0)
  const advTotal = advances.reduce((s, a) => s + r0(a.amount), 0)
  // Final pay: a loan can only take what the pay leaves; the rest is decided
  // on payday (write off, or keep as owed)
  if (leftOn) {
    let room = Math.max(0, gross - components.filter(c => c.isDeduction && c.kind !== 'loan').reduce((s, c) => s + c.amount, 0) - advTotal)
    for (const c of components.filter(c => c.kind === 'loan')) { c.amount = Math.min(c.amount, room); room -= c.amount }
  }
  const deductions = components.filter(c => c.isDeduction).reduce((s, c) => s + c.amount, 0)

  return {
    employee_id: emp.id,
    employee_name: emp.name,
    branch: emp.branch,
    days_present: present, days_half: half, days_absent: absent, payable_days: payableDays,
    components,
    gross, deductions, advances: advTotal,
    net_pay: gross - deductions - advTotal,
    advance_ids: advances.map(a => a.id),
    note: leftOn ? `Final settlement — left on ${leftOn}` : null,
    left_on: leftOn,
  }
}

// Days worked for a pay item, with a half day counted by the item's own rule
function payableDaysFor(present: number, half: number, policy: string) {
  return present + half * halfFactor(policy)
}

// Undo what a payday did for the people it settled for the last time: loans it
// wrote off come back, and they return to the payroll (active again)
async function undoLeaving(admin: any, vendorId: string, runId: string, from: string, to: string) {
  const { data: wo } = await admin.from('staff_loans').select('id, write_off_expense_id')
    .eq('vendor_id', vendorId).eq('written_off_run', runId)
  for (const l of wo || []) {
    if (l.write_off_expense_id) await admin.from('expenses').delete().eq('id', l.write_off_expense_id).eq('vendor_id', vendorId)
    await admin.from('staff_loans').update({ written_off_amount: 0, written_off_on: null, written_off_run: null, write_off_expense_id: null })
      .eq('id', l.id).eq('vendor_id', vendorId)
  }
  await admin.from('employees').update({ active: true, updated_at: new Date().toISOString() })
    .eq('vendor_id', vendorId).eq('active', false).gte('left_on', from).lte('left_on', to)
}

export async function GET(req: NextRequest) {
  const caller = await getOwner()
  if (!caller) return NextResponse.json({ error: 'Payroll is owner-only' }, { status: 403 })
  const admin = createAdminClient()

  const url = new URL(req.url)
  const period = url.searchParams.get('period') || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
  const { from, to } = cycleBounds(period)

  const { data: run } = await admin.from('payroll_runs')
    .select('*').eq('vendor_id', caller.vendor.id).eq('period', period).maybeSingle()

  // Advances taken against this cycle — shown whether the run is saved or
  // not, so the owner can always see what has already gone out against it.
  const { data: employeesAll } = await admin.from('employees')
    .select('*').eq('vendor_id', caller.vendor.id).eq('active', true).order('branch').order('name')
  // Someone who left before this cycle began was settled in an earlier one;
  // someone leaving inside it gets their final settlement here
  const employees = (employeesAll || []).filter((e: any) => !e.left_on || e.left_on >= from)
  const leaving = new Map<string, string>(employees.filter((e: any) => e.left_on && e.left_on <= to).map((e: any) => [e.id, e.left_on]))
  const empIds = employees.map((e: any) => e.id)

  // EVERY advance still unsettled up to the cycle end (the 24th) — not just
  // ones taken during it. An advance from a past cycle that no run deducted
  // has to come off this pay, or it sits against the person for ever. One
  // taken on the 26th belongs to the NEXT cycle and is excluded by the cutoff.
  // Nothing before the first in-system cycle: those were deducted on paper.
  const { data: advances } = empIds.length
    ? await admin.from('staff_advances').select('*').eq('vendor_id', caller.vendor.id)
        .gte('date', PAYROLL_FIRST_CYCLE_START)
        .lte('date', to).is('settled_in_run', null).order('date')
    : { data: [] as any[] }

  // ── Salary slip detail (?detail=1) ─────────────────────────────────────────
  // The slips the shop hands out (owner, 2026-09-23) list every day of the
  // cycle: working days for daily-paid staff, and each advance on the date it
  // was taken. Once a run is paid its advances are settled, so they're read
  // back by run; before that, the unsettled ones this run would deduct.
  async function slipDetail(ids: string[], paidRunId: string | null) {
    if (ids.length === 0) return {}
    const [{ data: emps }, { data: attAll }, { data: advAll }, { data: raises }] = await Promise.all([
      admin.from('employees').select('id, pay_type').in('id', ids),
      admin.from('staff_attendance').select('employee_id, date, status').in('employee_id', ids).gte('date', from).lte('date', to),
      paidRunId
        ? admin.from('staff_advances').select('employee_id, date, amount, note').eq('vendor_id', caller!.vendor.id).eq('settled_in_run', paidRunId).order('date')
        : Promise.resolve({ data: (advances || []).filter((a: any) => ids.includes(a.employee_id)) }),
      admin.from('salary_increments').select('employee_id, item_label, effective_from, new_amount')
        .eq('vendor_id', caller!.vendor.id).eq('status', 'scheduled').gt('effective_from', to).order('effective_from'),
    ])
    const out: Record<string, any> = {}
    for (const id of ids) {
      out[id] = {
        pay_type: (emps || []).find((e: any) => e.id === id)?.pay_type || 'monthly',
        attendance: (attAll || []).filter((a: any) => a.employee_id === id).map((a: any) => ({ date: a.date, status: a.status })),
        advances: (advAll || []).filter((a: any) => a.employee_id === id).map((a: any) => ({ date: a.date, amount: r0(a.amount), note: a.note || null })),
        next_raise: (raises || []).find((r: any) => r.employee_id === id) || null,
      }
    }
    return out
  }
  const wantDetail = url.searchParams.get('detail') === '1'

  if (run) {
    const { data: lines } = await admin.from('payroll_lines')
      .select('*').eq('run_id', run.id).order('employee_name')
    // A draft keeps the figures it was saved with — but a loan entered (or
    // deleted) after saving must still reach it, or it silently never comes
    // off pay (Buddhini, Sep 2026). The change is proposed, not saved: the
    // screen marks the draft unsaved and payday needs it saved first.
    const loanChanges: { employee_name: string; change: 'added' | 'removed'; amount: number }[] = []
    if (run.status !== 'paid' && (lines || []).length > 0) {
      const all = await loansWithBalance(admin, caller.vendor.id, (lines || []).map((l: any) => l.employee_id))
      const due = all.filter(l => (l.date < from || leaving.has(l.employee_id)) && l.balance > 0)
      for (const l of lines || []) {
        const comps = [...(l.components || [])]
        let changed = false
        // A loan that no longer exists can't be repaid
        for (let i = comps.length - 1; i >= 0; i--) {
          const c = comps[i]
          if (c.kind === 'loan' && c.loan_id && !all.some(x => x.id === c.loan_id)) {
            loanChanges.push({ employee_name: l.employee_name, change: 'removed', amount: r0(c.amount) })
            comps.splice(i, 1); changed = true
          }
        }
        for (const loan of due.filter(x => x.employee_id === l.employee_id)) {
          if (comps.some((c: any) => c.kind === 'loan' && c.loan_id === loan.id)) continue
          const amount = leaving.has(l.employee_id) ? loan.balance : Math.min(loan.instalment, loan.balance)
          comps.push({
            kind: 'loan', label: 'Loan repayment', unit: 'cash', period: 'monthly',
            qty: 1, rate: loan.instalment, amount, isDeduction: true,
            loan_id: loan.id, balance: loan.balance,
          })
          loanChanges.push({ employee_name: l.employee_name, change: 'added', amount })
          changed = true
        }
        if (changed) {
          const gross = comps.filter((c: any) => !c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
          const deductions = comps.filter((c: any) => c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
          Object.assign(l, { components: comps, gross, deductions, net_pay: gross - deductions - r0(l.advances) })
        }
      }
    }
    // Leaving recorded after the draft was saved: turn their line into the
    // final settlement — monthly pay ÷ 25 × days, whole loan as far as the pay covers
    const leaveChanges: string[] = []
    if (run.status !== 'paid') {
      for (const l of (lines || []) as any[]) {
        const leftOn = leaving.get(l.employee_id)
        if (!leftOn) continue
        const comps = (l.components || []).map((c: any) => ({ ...c }))
        let changed = false
        for (const c of comps) {
          if (!c.isDeduction && c.period === 'monthly' && c.unit === 'rs' && !c.prorated) {
            c.amount = r0((Number(c.rate) || 0) / 25 * Number(l.payable_days || 0)); c.prorated = true; changed = true
          }
          if (c.kind === 'loan' && !c.final && r0(c.amount) < r0(c.balance)) { c.amount = r0(c.balance); c.final = true; changed = true }
        }
        if (!changed) continue
        const gross = comps.filter((c: any) => !c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
        let room = Math.max(0, gross - comps.filter((c: any) => c.isDeduction && c.kind !== 'loan').reduce((t: number, c: any) => t + r0(c.amount), 0) - r0(l.advances))
        for (const c of comps.filter((c: any) => c.kind === 'loan')) { c.amount = Math.min(r0(c.amount), room); room -= c.amount }
        const deductions = comps.filter((c: any) => c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
        const before = r0(l.net_pay)
        Object.assign(l, { components: comps, gross, deductions, net_pay: gross - deductions - r0(l.advances), note: `Final settlement — left on ${leftOn}` })
        leaveChanges.push(`${l.employee_name}: leaving on ${leftOn} — final settlement, pay ${rsText(before)} → ${rsText(r0(l.net_pay))}`)
      }
    }
    // Attendance and advances marked since the draft was saved
    const draftChanges: string[] = [...leaveChanges, ...loanChanges.map(c => c.change === 'added'
      ? `${c.employee_name}: loan repayment ${rsText(c.amount)} added`
      : `${c.employee_name}: loan repayment ${rsText(c.amount)} removed — that loan was deleted`)]
    if (run.status !== 'paid') draftChanges.push(...await refreshDraftLines(admin, caller.vendor.id, lines || [], from, to))
    const detail = wantDetail ? await slipDetail((lines || []).map((l: any) => l.employee_id), run.status === 'paid' ? run.id : null) : undefined
    // Who is being settled for the last time in this cycle (paid runs too —
    // by then the person is inactive, so ask by id)
    if ((lines || []).length) {
      const { data: lv } = await admin.from('employees').select('id, left_on').in('id', (lines || []).map((l: any) => l.employee_id))
      for (const l of lines || []) {
        const e = (lv || []).find((x: any) => x.id === l.employee_id)
        if (e?.left_on && e.left_on >= from && e.left_on <= to) (l as any).left_on = e.left_on
      }
    }
    return NextResponse.json({ period, run, lines: lines || [], saved: true, draftChanges, advances: advances || [], cycle: { from, to }, detail })
  }

  // No run yet — build the proposal
  const { data: items } = empIds.length
    ? await admin.from('employee_pay_items').select('*').in('employee_id', empIds).eq('active', true)
    : { data: [] as any[] }
  const { data: att } = empIds.length
    ? await admin.from('staff_attendance').select('*').in('employee_id', empIds).gte('date', from).lte('date', to)
    : { data: [] as any[] }
  // Repayment starts with the first payroll AFTER the loan: one handed over
  // during this cycle is repaid from next month, not taken straight back.
  const loans = (await loansWithBalance(admin, caller.vendor.id, empIds)).filter(l => (l.date < from || leaving.has(l.employee_id)) && l.balance > 0)

  const lines = employees
    // Someone who joined after the cycle ended has nothing to be paid for it
    .filter((e: any) => !e.join_date || e.join_date <= to)
    .map((e: any) => proposeLine(
      e,
      (items || []).filter((i: any) => i.employee_id === e.id),
      (att || []).filter((a: any) => a.employee_id === e.id),
      (advances || []).filter((a: any) => a.employee_id === e.id),
      loans.filter(l => l.employee_id === e.id),
      leaving.get(e.id) || null,
    ))

  const detail = wantDetail ? await slipDetail(lines.map((l: any) => l.employee_id), null) : undefined
  return NextResponse.json({ period, run: null, lines, saved: false, advances: advances || [], cycle: { from, to }, detail })
}

export async function POST(req: NextRequest) {
  const caller = await getOwner()
  if (!caller) return NextResponse.json({ error: 'Payroll is owner-only' }, { status: 403 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { action } = body

  // ── Save (or re-save) the month as a draft — nothing hits the books yet ──
  if (action === 'save_draft') {
    const { period, lines, note } = body
    if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
    // The system pays from the 25 Aug – 24 Sep 2026 cycle onwards (owner,
    // 2026-08-24): earlier cycles were paid outside it, and a run saved here
    // by mistake would double-pay the month and hit the cash book.
    if (period < '2026-09') {
      return NextResponse.json({ error: 'Payroll here starts with the 25 Aug – 24 Sep 2026 cycle — earlier salaries were paid outside the system' }, { status: 400 })
    }
    if (!Array.isArray(lines) || lines.length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })

    const { data: existing } = await admin.from('payroll_runs')
      .select('id, status').eq('vendor_id', caller.vendor.id).eq('period', period).maybeSingle()
    if (existing?.status === 'paid') {
      return NextResponse.json({ error: 'This month is already paid — reopen it before changing anything' }, { status: 400 })
    }

    const totals = lines.reduce((t: any, l: any) => ({
      gross: t.gross + r0(l.gross), deductions: t.deductions + r0(l.deductions),
      advances: t.advances + r0(l.advances), net: t.net + r0(l.net_pay),
    }), { gross: 0, deductions: 0, advances: 0, net: 0 })

    let runId = existing?.id
    if (runId) {
      await admin.from('payroll_runs').update({
        gross_total: totals.gross, deduction_total: totals.deductions,
        advance_total: totals.advances, net_total: totals.net,
        note: note || null, updated_at: new Date().toISOString(),
      }).eq('id', runId).eq('vendor_id', caller.vendor.id)
      await admin.from('payroll_lines').delete().eq('run_id', runId)
    } else {
      const { data: created, error } = await admin.from('payroll_runs').insert({
        vendor_id: caller.vendor.id, period, status: 'draft',
        gross_total: totals.gross, deduction_total: totals.deductions,
        advance_total: totals.advances, net_total: totals.net,
        note: note || null, created_by: caller.email,
      }).select('id').single()
      if (error || !created) return NextResponse.json({ error: error?.message || 'Could not start the run' }, { status: 500 })
      runId = created.id
    }

    const rows = lines.map((l: any) => ({
      run_id: runId, employee_id: l.employee_id, employee_name: l.employee_name, branch: l.branch || null,
      days_present: l.days_present || 0, days_half: l.days_half || 0, days_absent: l.days_absent || 0,
      payable_days: l.payable_days || 0,
      components: l.components || [],
      gross: r0(l.gross), deductions: r0(l.deductions), advances: r0(l.advances), net_pay: r0(l.net_pay),
      note: l.note || null,
    }))
    const { error: lineErr } = await admin.from('payroll_lines').insert(rows)
    if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, runId })
  }

  // ── Payday ───────────────────────────────────────────────────────────────
  // One salaries expense per person for the balance actually handed over, and
  // the advances they took are settled against this run so they can never be
  // deducted twice.
  if (action === 'mark_paid') {
    const { runId, paid_date, payment_method } = body
    if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 })
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(paid_date || ''))
      ? paid_date : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    // 'owner' = paid from the owner's own pocket: still the company's salary
    // cost, but it leaves neither the drawer nor the bank
    const method = payment_method === 'online' || payment_method === 'owner' ? payment_method : 'cash'

    const { data: run } = await admin.from('payroll_runs')
      .select('*').eq('id', runId).eq('vendor_id', caller.vendor.id).single()
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (run.status === 'paid') return NextResponse.json({ error: 'This run is already paid' }, { status: 400 })

    const { data: lines } = await admin.from('payroll_lines').select('*').eq('run_id', runId)
    if (!lines || lines.length === 0) return NextResponse.json({ error: 'This run has no lines' }, { status: 400 })

    // Pay exactly what the register says: refuse a draft that attendance or
    // advances have moved on from since it was saved (the Sep 2026 short pay)
    {
      const { from: cFrom, to: cTo } = cycleBounds(run.period)
      const stale = await refreshDraftLines(admin, caller.vendor.id, JSON.parse(JSON.stringify(lines)), cFrom, cTo)
      if (stale.length > 0) {
        return NextResponse.json({ error: `Attendance or advances changed since this payroll was saved — reload payroll, check and save again. ${stale.join(' · ')}` }, { status: 409 })
      }
    }

    // ── Loan repayments: check before anything moves ────────────────────────
    // The draft holds what the owner left on each loan line; the balance may
    // have changed since it was saved, so it's checked against the real one.
    const loanParts = lines.flatMap((l: any) => (l.components || [])
      .filter((c: any) => c.kind === 'loan' && c.loan_id && r0(c.amount) > 0)
      .map((c: any) => ({ line: l, loan_id: c.loan_id as string, amount: r0(c.amount) })))
    if (loanParts.length > 0) {
      const balances = await loansWithBalance(admin, caller.vendor.id, [...new Set(loanParts.map(p => p.line.employee_id as string))])
      for (const p of loanParts) {
        const loan = balances.find(b => b.id === p.loan_id)
        if (!loan) return NextResponse.json({ error: `${p.line.employee_name}: that loan is no longer on record — reload payroll and save again` }, { status: 400 })
        if (p.amount > loan.balance) return NextResponse.json({ error: `${p.line.employee_name}: loan repayment ${rsText(p.amount)} is more than the ${rsText(loan.balance)} left — lower it` }, { status: 400 })
      }
      // A repayment can't come out of pay that isn't there — otherwise the
      // loan would quietly turn into a carried advance
      for (const l of lines) {
        if (r0(l.net_pay) < 0 && loanParts.some(p => p.line.id === l.id)) {
          return NextResponse.json({ error: `${l.employee_name}'s pay doesn't cover the loan repayment this month — lower it or type 0 to skip` }, { status: 400 })
        }
      }
    }

    // ── Leaving this cycle: final settlement ─────────────────────────────────
    // A loan the final pay doesn't cover is decided per case (owner,
    // 2026-09-30: mostly written off) — the screen asks, nothing is assumed.
    const { to: cycleTo, from: cycleFrom } = cycleBounds(run.period)
    const { data: lv } = await admin.from('employees').select('id, name, left_on')
      .in('id', lines.map((l: any) => l.employee_id))
    const leavers = (lv || []).filter((e: any) => e.left_on && e.left_on >= cycleFrom && e.left_on <= cycleTo)
    const remainders: { loan: any; employee: any; left: number; decision: 'write_off' | 'keep' }[] = []
    if (leavers.length > 0) {
      const decisions = (body.loan_remainders || {}) as Record<string, string>
      const loans = await loansWithBalance(admin, caller.vendor.id, leavers.map((e: any) => e.id))
      for (const loan of loans) {
        const repaying = loanParts.filter(p => p.loan_id === loan.id).reduce((t, p) => t + p.amount, 0)
        const left = loan.balance - repaying
        if (left <= 0) continue
        const employee = leavers.find((e: any) => e.id === loan.employee_id)
        const d = decisions[loan.id]
        if (d !== 'write_off' && d !== 'keep') {
          return NextResponse.json({ error: `${employee?.name}'s final pay leaves ${rsText(left)} of their loan — choose write off or keep as owed` }, { status: 400 })
        }
        remainders.push({ loan, employee, left, decision: d })
      }
    }

    // A cash payday belongs to that day's drawer
    let sessionId: string | null = null
    if (method === 'cash') {
      const { data: sess } = await admin.from('cash_sessions')
        .select('id').eq('vendor_id', caller.vendor.id).eq('session_date', date).maybeSingle()
      sessionId = sess?.id || null
    }

    const posted: string[] = []
    for (const l of lines) {
      if (r0(l.net_pay) <= 0) continue   // fully covered by advances — no cash moves
      const { data: exp, error } = await admin.from('expenses').insert({
        vendor_id: caller.vendor.id, expense_date: date, category: 'salaries',
        description: `Salary cycle ${cycleLabel(run.period)} — ${l.employee_name}${method === 'owner' ? ' (paid by owner)' : ''}`,
        amount: r0(l.net_pay), payment_method: method,
        cash_session_id: sessionId, created_by: caller.userId,
      }).select('id').single()
      if (error || !exp) {
        // Roll back every expense already posted: a half-paid payroll would
        // leave the cash book claiming money moved that never did.
        if (posted.length) await admin.from('expenses').delete().in('id', posted)
        return NextResponse.json({ error: 'Could not post the payment: ' + (error?.message || 'unknown') }, { status: 500 })
      }
      posted.push(exp.id)
      await admin.from('payroll_lines').update({ expense_id: exp.id }).eq('id', l.id)
    }

    // Settle the advances this run actually deducted — and only those. If the
    // owner zeroed someone's advance line, their advances stay outstanding and
    // roll into the next run rather than being quietly written off.
    const { to } = cycleBounds(run.period)
    const deductedFrom = lines.filter((l: any) => r0(l.advances) > 0).map((l: any) => l.employee_id)
    if (deductedFrom.length > 0) {
      await admin.from('staff_advances').update({ settled_in_run: runId })
        .eq('vendor_id', caller.vendor.id).in('employee_id', deductedFrom)
        .gte('date', PAYROLL_FIRST_CYCLE_START)
        .lte('date', to).is('settled_in_run', null)
    }

    // If either write below fails, everything this payday did is put back —
    // a half-recorded payday is worse than none.
    const undo = async () => {
      if (posted.length) await admin.from('expenses').delete().in('id', posted)
      await admin.from('payroll_lines').update({ expense_id: null }).eq('run_id', runId)
      await admin.from('staff_advances').update({ settled_in_run: null }).eq('vendor_id', caller.vendor.id).eq('settled_in_run', runId)
      await admin.from('staff_loan_repayments').delete().eq('run_id', runId)
      await admin.from('staff_advances').delete().eq('vendor_id', caller.vendor.id).eq('carried_from_run', runId)
      await undoLeaving(admin, caller.vendor.id, runId, cycleFrom, cycleTo)
    }

    // What came off each loan
    if (loanParts.length > 0) {
      const { error: repErr } = await admin.from('staff_loan_repayments').insert(loanParts.map(p => ({
        vendor_id: caller.vendor.id, loan_id: p.loan_id, employee_id: p.line.employee_id, run_id: runId, amount: p.amount,
      })))
      if (repErr) { await undo(); return NextResponse.json({ error: 'Could not record the loan repayments: ' + repErr.message }, { status: 500 }) }
    }

    // Advances bigger than the pay: every advance above was just settled, so
    // the part the pay didn't cover is carried into the next cycle as a new
    // advance dated its first day. It used to be written off here while the
    // screen said "the balance stays owing" (owner, 2026-09-23).
    const short = lines.filter((l: any) => r0(l.net_pay) < 0)
    if (short.length > 0) {
      const { error: carryErr } = await admin.from('staff_advances').insert(short.map((l: any) => ({
        vendor_id: caller.vendor.id, employee_id: l.employee_id,
        amount: -r0(l.net_pay), date: `${run.period}-25`, source: 'carried',
        note: `Carried from salary ${cycleLabel(run.period)} — advances were more than the pay`,
        carried_from_run: runId, entered_by: caller.email,
      })))
      if (carryErr) { await undo(); return NextResponse.json({ error: 'Could not carry the unpaid balance forward: ' + carryErr.message }, { status: 500 }) }
    }

    // Loans the final pay didn't cover: written off as a loss, or left owed
    for (const r of remainders.filter(x => x.decision === 'write_off')) {
      const { data: exp, error: wErr } = await admin.from('expenses').insert({
        vendor_id: caller.vendor.id, expense_date: date, category: 'staff_loan_writeoff',
        description: `Staff loan written off — ${r.employee?.name} (left on ${r.employee?.left_on})`,
        amount: r.left, payment_method: 'none', created_by: caller.userId,
      }).select('id').single()
      if (wErr || !exp) { await undo(); return NextResponse.json({ error: 'Could not write the loan off: ' + (wErr?.message || 'unknown') }, { status: 500 }) }
      const { error: lErr } = await admin.from('staff_loans').update({
        written_off_amount: Number(r.loan.written_off || 0) + r.left, written_off_on: date,
        written_off_run: runId, write_off_expense_id: exp.id,
      }).eq('id', r.loan.id).eq('vendor_id', caller.vendor.id)
      if (lErr) { await admin.from('expenses').delete().eq('id', exp.id); await undo(); return NextResponse.json({ error: 'Could not write the loan off: ' + lErr.message }, { status: 500 }) }
    }
    // Settled for the last time: off future payrolls and attendance, history kept
    if (leavers.length > 0) {
      await admin.from('employees').update({ active: false, updated_at: new Date().toISOString() })
        .in('id', leavers.map((e: any) => e.id)).eq('vendor_id', caller.vendor.id)
    }

    await admin.from('payroll_runs').update({
      status: 'paid', paid_date: date, payment_method: method, updated_at: new Date().toISOString(),
    }).eq('id', runId).eq('vendor_id', caller.vendor.id)

    if (method === 'cash') await recomputeSessionForDate(admin, caller.vendor.id, date)

    admin.from('staff_audit').insert({
      vendor_id: caller.vendor.id, actor: caller.email, action: 'payroll_paid',
      detail: { period: run.period, net: run.net_total, date, method, people: posted.length,
        final: leavers.map((e: any) => e.name), written_off: remainders.filter(x => x.decision === 'write_off').map(x => ({ name: x.employee?.name, amount: x.left })) },
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true, paid: posted.length })
  }

  // ── Unwind a payday ──────────────────────────────────────────────────────
  if (action === 'reopen') {
    const { runId } = body
    const { data: run } = await admin.from('payroll_runs')
      .select('*').eq('id', runId).eq('vendor_id', caller.vendor.id).single()
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (run.status !== 'paid') return NextResponse.json({ error: 'This run is already a draft' }, { status: 400 })

    // A balance this payday carried forward that a later payroll has already
    // deducted can't be pulled back from under it
    const { data: carried } = await admin.from('staff_advances')
      .select('id, settled_in_run').eq('vendor_id', caller.vendor.id).eq('carried_from_run', runId)
    if ((carried || []).some((c: any) => c.settled_in_run)) {
      return NextResponse.json({ error: 'A balance carried from this month has already come off a later payroll — reopen that one first' }, { status: 400 })
    }
    await admin.from('staff_advances').delete().eq('vendor_id', caller.vendor.id).eq('carried_from_run', runId)
    // Put the loan balances back as they were before this payday
    await admin.from('staff_loan_repayments').delete().eq('run_id', runId)
    { const { from: rf, to: rt } = cycleBounds(run.period); await undoLeaving(admin, caller.vendor.id, runId, rf, rt) }

    const { data: lines } = await admin.from('payroll_lines').select('id, expense_id').eq('run_id', runId)
    const expenseIds = (lines || []).map((l: any) => l.expense_id).filter(Boolean)
    if (expenseIds.length) await admin.from('expenses').delete().in('id', expenseIds).eq('vendor_id', caller.vendor.id)
    await admin.from('payroll_lines').update({ expense_id: null }).eq('run_id', runId)
    // Hand the advances back so the next attempt deducts them again
    await admin.from('staff_advances').update({ settled_in_run: null })
      .eq('vendor_id', caller.vendor.id).eq('settled_in_run', runId)
    await admin.from('payroll_runs').update({ status: 'draft', paid_date: null }).eq('id', runId)

    if (run.payment_method === 'cash' && run.paid_date) {
      await recomputeSessionForDate(admin, caller.vendor.id, run.paid_date)
    }
    admin.from('staff_audit').insert({
      vendor_id: caller.vendor.id, actor: caller.email, action: 'payroll_reopened',
      detail: { period: run.period, reversed: expenseIds.length },
    }).then(() => {}, () => {})

    return NextResponse.json({ ok: true })
  }

  // ── Throw away a draft and start again ───────────────────────────────────
  if (action === 'delete_draft') {
    const { runId } = body
    const { data: run } = await admin.from('payroll_runs')
      .select('id, status').eq('id', runId).eq('vendor_id', caller.vendor.id).single()
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (run.status === 'paid') return NextResponse.json({ error: 'Reopen the run before deleting it' }, { status: 400 })
    await admin.from('payroll_runs').delete().eq('id', runId).eq('vendor_id', caller.vendor.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
