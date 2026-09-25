// ─────────────────────────────────────────────────────────────────────────────
// Salary cost of a date range — WHEEL MART Profit Report
//
// Salary is paid ~the 25th for the 25th→24th cycle, so a window that ends
// before payday carries almost no salary cost and profit reads a full payroll
// better than it is. Owner, 2026-09-06: the cost is knowable — daily-paid
// staff have a rate and attendance; monthly staff cost (monthly pay ÷ 25
// working days) × days worked in the window.
//
// Owner, 2026-09-25: once a cycle's payroll is marked PAID, its real figure
// replaces that estimate — ÷25 overcharges a monthly person who works 26 days
// (Buddhini, Sep 2026: Rs.57,200 charged against Rs.55,000 paid), and
// commissions entered on payday never reached the estimate at all. The cost of
// a paid line is what they earned less leave/other deductions; advances, loan
// repayments and EPF only change how the pay is handed over, not what it
// cost. A window covering part of a paid cycle takes each person's share by
// their days worked in it.
// ─────────────────────────────────────────────────────────────────────────────

export const SALARY_WORKING_DAYS = 25

export type SalaryLine = { name: string; payType: string; daysWorked: number; amount: number; source: 'payroll' | 'estimate' | 'both' }
export type SalaryBasis = 'payroll' | 'mixed' | 'attendance' | 'estimated' | 'none'

const r0 = (n: any) => Math.round(Number(n) || 0)

/** `runStatuses` is which payroll runs count as settled — 'paid' outside tests. */
export async function salaryCost(admin: any, vendorId: string, from: string, to: string, runStatuses: string[] = ['paid']):
  Promise<{ total: number; basis: SalaryBasis; lines: SalaryLine[] }> {
  const WORKING_DAYS_PER_MONTH = SALARY_WORKING_DAYS
  let salaryAccrual = 0
  let salaryBasis: SalaryBasis = 'none'
  const salaryLines: SalaryLine[] = []
  const ym = (y: number, m: number) => { const t = new Date(Date.UTC(y, m - 1, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}` }
  const periodOf = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return dd >= 25 ? ym(y, m + 1) : ym(y, m) }
  const cycleOf = (p: string) => {
    const [y, m] = p.split('-').map(Number)
    return { from: `${ym(y, m - 1)}-25`, to: `${p}-24` }
  }
  const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
  const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1

  // The cycles the window touches, and the slice of each inside it
  const segments: { period: string; cycleFrom: string; cycleTo: string; from: string; to: string }[] = []
  for (let p = periodOf(from); p <= periodOf(to); p = periodOf(addDays(cycleOf(p).to, 1))) {
    const c = cycleOf(p)
    segments.push({ period: p, cycleFrom: c.from, cycleTo: c.to, from: c.from > from ? c.from : from, to: c.to < to ? c.to : to })
  }
  const attFrom = segments[0].cycleFrom, attTo = segments[segments.length - 1].cycleTo

  const { data: emps } = await admin.from('employees')
    .select('id, name, pay_type, active').eq('vendor_id', vendorId)
  const ids = (emps || []).map((e: any) => e.id)
  const [{ data: items }, { data: att }, { data: paidRuns }] = await Promise.all([
    ids.length
      ? admin.from('employee_pay_items').select('employee_id, kind, unit, period, amount, half_day_policy')
          .in('employee_id', ids).eq('active', true).eq('unit', 'rs').in('kind', ['base', 'allowance', 'other'])
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? admin.from('staff_attendance').select('employee_id, status, date')
          .in('employee_id', ids).gte('date', attFrom).lte('date', attTo)
      : Promise.resolve({ data: [] as any[] }),
    admin.from('payroll_runs').select('id, period').eq('vendor_id', vendorId)
      .in('status', runStatuses).in('period', segments.map(sg => sg.period)),
  ])
  const runIds = (paidRuns || []).map((r: any) => r.id)
  const { data: paidLines } = runIds.length
    ? await admin.from('payroll_lines').select('run_id, employee_id, employee_name, gross, components').in('run_id', runIds)
    : { data: [] as any[] }

  // Pay earned for days worked between two dates — the ÷25 estimate
  const accrue = (empId: string, a: string, b: string, noRegister: boolean) => {
    const mine = (att || []).filter((x: any) => x.employee_id === empId && x.date >= a && x.date <= b)
    const present = noRegister
      ? Math.round(daysBetween(a, b) * WORKING_DAYS_PER_MONTH / 30 * 2) / 2
      : mine.filter((x: any) => x.status === 'present').length
    const half = noRegister ? 0 : mine.filter((x: any) => x.status === 'half').length
    let amount = 0
    for (const it of (items || []).filter((i: any) => i.employee_id === empId)) {
      const perDay = it.period === 'monthly' ? Number(it.amount) / WORKING_DAYS_PER_MONTH
                   : it.period === 'daily' ? Number(it.amount) : 0
      const halfFactor = it.half_day_policy === 'none' ? 0 : it.half_day_policy === 'full' ? 1 : 0.5
      amount += perDay * (present + halfFactor * half)
    }
    return { amount, days: present + 0.5 * half }
  }
  // No attendance marked at all for these dates (an old period, or a shop
  // not using the register): assume 25 working days in 30, and say so.
  const registerEmpty = (a: string, b: string) => !(att || []).some((x: any) => x.date >= a && x.date <= b)

  const byEmp = new Map<string, SalaryLine>()
  const addTo = (empId: string, name: string, payType: string, days: number, amount: number, src: 'payroll' | 'estimate') => {
    const cur = byEmp.get(empId)
    if (!cur) { byEmp.set(empId, { name, payType, daysWorked: days, amount, source: src }); return }
    cur.daysWorked += days; cur.amount += amount
    if (cur.source !== src) cur.source = 'both'
  }
  let paidSegs = 0, estimated = false
  for (const sg of segments) {
    const run = (paidRuns || []).find((r: any) => r.period === sg.period)
    if (run) {
      paidSegs++
      const whole = sg.from === sg.cycleFrom && sg.to === sg.cycleTo
      const noReg = registerEmpty(sg.cycleFrom, sg.cycleTo)
      for (const l of (paidLines || []).filter((x: any) => x.run_id === run.id)) {
        const cost = r0(l.gross) - (l.components || [])
          .filter((c: any) => c.isDeduction && c.kind !== 'loan' && c.kind !== 'epf')
          .reduce((t: number, c: any) => t + r0(c.amount), 0)
        const inSeg = accrue(l.employee_id, sg.from, sg.to, noReg)
        let share = 1
        if (!whole) {
          const full = accrue(l.employee_id, sg.cycleFrom, sg.cycleTo, noReg)
          share = full.amount > 0 ? inSeg.amount / full.amount : daysBetween(sg.from, sg.to) / daysBetween(sg.cycleFrom, sg.cycleTo)
        }
        const emp = (emps || []).find((e: any) => e.id === l.employee_id)
        addTo(l.employee_id, l.employee_name, emp?.pay_type || 'monthly', inSeg.days, cost * share, 'payroll')
      }
    } else {
      const noReg = registerEmpty(sg.from, sg.to)
      if (noReg) estimated = true
      for (const e of (emps || []).filter((x: any) => x.active)) {
        const a = accrue(e.id, sg.from, sg.to, noReg)
        if (a.amount > 0 || a.days > 0) addTo(e.id, e.name, e.pay_type, a.days, a.amount, 'estimate')
      }
    }
  }
  for (const l of byEmp.values()) {
    if (l.amount === 0 && l.daysWorked === 0) continue
    salaryLines.push({ ...l, amount: r0(l.amount) })
    salaryAccrual += l.amount
  }
  salaryAccrual = r0(salaryAccrual)
  if (salaryAccrual > 0) {
    salaryBasis = paidSegs === segments.length ? 'payroll'
      : paidSegs > 0 ? 'mixed'
      : estimated ? 'estimated' : 'attendance'
  }
  return { total: salaryAccrual, basis: salaryBasis, lines: salaryLines }
}
