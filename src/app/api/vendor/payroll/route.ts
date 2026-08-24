import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'

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
function proposeLine(emp: any, items: any[], att: any[], advances: any[]) {
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

    // Monthly cash amount, prorated by attendance. With no attendance marked
    // at all, pay the full month — missing data is not an absence.
    const factor = marked > 0 ? payableDays / marked : 1
    components.push({
      ...base, qty: 1, rate,
      amount: r0(rate * factor),
      proratedFrom: marked > 0 && payableDays < marked ? { payableDays, marked } : null,
    })
  }

  // EPF on a percentage takes the base salary as computed above
  const baseEarned = components.filter(c => c.kind === 'base').reduce((s, c) => s + c.amount, 0)
  for (const c of components) {
    if (c.kind === 'epf' && c.unit === 'percent') { c.amount = r0(baseEarned * c.rate / 100); c.needsInput = false }
    else if (c.kind === 'epf') c.amount = r0(c.rate)
  }

  const gross = components.filter(c => !c.isDeduction).reduce((s, c) => s + c.amount, 0)
  const deductions = components.filter(c => c.isDeduction).reduce((s, c) => s + c.amount, 0)
  const advTotal = advances.reduce((s, a) => s + r0(a.amount), 0)

  return {
    employee_id: emp.id,
    employee_name: emp.name,
    branch: emp.branch,
    days_present: present, days_half: half, days_absent: absent, payable_days: payableDays,
    components,
    gross, deductions, advances: advTotal,
    net_pay: gross - deductions - advTotal,
    advance_ids: advances.map(a => a.id),
    note: null,
  }
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
  const { data: employees } = await admin.from('employees')
    .select('*').eq('vendor_id', caller.vendor.id).eq('active', true).order('branch').order('name')
  const empIds = (employees || []).map((e: any) => e.id)

  // EVERY advance still unsettled up to the cycle end (the 24th) — not just
  // ones taken during it. An advance from a past cycle that no run deducted
  // has to come off this pay, or it sits against the person for ever. One
  // taken on the 26th belongs to the NEXT cycle and is excluded by the cutoff.
  const { data: advances } = empIds.length
    ? await admin.from('staff_advances').select('*').eq('vendor_id', caller.vendor.id)
        .lte('date', to).is('settled_in_run', null).order('date')
    : { data: [] as any[] }

  if (run) {
    const { data: lines } = await admin.from('payroll_lines')
      .select('*').eq('run_id', run.id).order('employee_name')
    return NextResponse.json({ period, run, lines: lines || [], saved: true, advances: advances || [] })
  }

  // No run yet — build the proposal
  const { data: items } = empIds.length
    ? await admin.from('employee_pay_items').select('*').in('employee_id', empIds).eq('active', true)
    : { data: [] as any[] }
  const { data: att } = empIds.length
    ? await admin.from('staff_attendance').select('*').in('employee_id', empIds).gte('date', from).lte('date', to)
    : { data: [] as any[] }

  const lines = (employees || [])
    // Someone who joined after the cycle ended has nothing to be paid for it
    .filter((e: any) => !e.join_date || e.join_date <= to)
    .map((e: any) => proposeLine(
      e,
      (items || []).filter((i: any) => i.employee_id === e.id),
      (att || []).filter((a: any) => a.employee_id === e.id),
      (advances || []).filter((a: any) => a.employee_id === e.id),
    ))

  return NextResponse.json({ period, run: null, lines, saved: false, advances: advances || [] })
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
    const method = payment_method === 'online' ? 'online' : 'cash'

    const { data: run } = await admin.from('payroll_runs')
      .select('*').eq('id', runId).eq('vendor_id', caller.vendor.id).single()
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (run.status === 'paid') return NextResponse.json({ error: 'This run is already paid' }, { status: 400 })

    const { data: lines } = await admin.from('payroll_lines').select('*').eq('run_id', runId)
    if (!lines || lines.length === 0) return NextResponse.json({ error: 'This run has no lines' }, { status: 400 })

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
        description: `Salary cycle ${cycleLabel(run.period)} — ${l.employee_name}`,
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
        .lte('date', to).is('settled_in_run', null)
    }

    await admin.from('payroll_runs').update({
      status: 'paid', paid_date: date, payment_method: method, updated_at: new Date().toISOString(),
    }).eq('id', runId).eq('vendor_id', caller.vendor.id)

    if (method === 'cash') await recomputeSessionForDate(admin, caller.vendor.id, date)

    admin.from('staff_audit').insert({
      vendor_id: caller.vendor.id, actor: caller.email, action: 'payroll_paid',
      detail: { period: run.period, net: run.net_total, date, method, people: posted.length },
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
