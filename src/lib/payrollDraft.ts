import { PAYROLL_FIRST_CYCLE_START } from '@/lib/payrollStart'

const r0 = (n: any) => Math.round(Number(n) || 0)
const rsText = (n: number) => 'Rs.' + r0(n).toLocaleString('en-US')
// Same rule as payroll's proposal: a half day pays half unless the item says otherwise
const halfFactor = (policy: string | undefined) => (policy === 'full' ? 1 : policy === 'none' ? 0 : 0.5)

// ── A saved draft must not go stale ──────────────────────────────────────────
// A draft keeps the figures it was saved with. September 2026 was saved on the
// morning of the 24th, before that day's attendance was marked, then paid on
// the 25th: Sanath, Abubakkar and Dasun were each paid a day (or half) short —
// Rs.7,750 — while their slips, which read the register live, showed the day
// worked. Advances drift the same way: one given after saving was settled on
// payday without ever coming off pay.
//
// This re-reads attendance and unsettled advances for an unpaid draft and
// brings the lines up to date: day counts, the daily pay lines (wage, food
// allowance) unless the owner typed a different quantity in, EPF on a
// percentage, and the advances total. Mutates `lines`; returns one message per
// person changed. Monthly salary is fixed by design and never moves here.
export async function refreshDraftLines(admin: any, vendorId: string, lines: any[], from: string, to: string): Promise<string[]> {
  if (!lines.length) return []
  const ids = lines.map((l: any) => l.employee_id)
  const [{ data: items }, { data: att }, { data: advs }] = await Promise.all([
    admin.from('employee_pay_items').select('employee_id, kind, label, period, half_day_policy').in('employee_id', ids).eq('active', true),
    admin.from('staff_attendance').select('employee_id, status').in('employee_id', ids).gte('date', from).lte('date', to),
    admin.from('staff_advances').select('employee_id, amount').eq('vendor_id', vendorId).in('employee_id', ids)
      .gte('date', PAYROLL_FIRST_CYCLE_START).lte('date', to).is('settled_in_run', null),
  ])
  const days = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)
  const out: string[] = []
  for (const l of lines) {
    const mine = (att || []).filter((a: any) => a.employee_id === l.employee_id)
    const present = mine.filter((a: any) => a.status === 'present').length
    const half = mine.filter((a: any) => a.status === 'half').length
    const absent = mine.filter((a: any) => a.status === 'absent').length
    const daysChanged = present !== Number(l.days_present || 0) || half !== Number(l.days_half || 0) || absent !== Number(l.days_absent || 0)
    const advance = (advs || []).filter((a: any) => a.employee_id === l.employee_id).reduce((t: number, a: any) => t + r0(a.amount), 0)
    const advChanged = advance !== r0(l.advances)
    if (!daysChanged && !advChanged) continue

    const before = { net: r0(l.net_pay), payable: Number(l.payable_days || 0), adv: r0(l.advances) }
    const comps = (l.components || []).map((c: any) => ({ ...c }))
    const leftAsTyped: string[] = []
    if (daysChanged) {
      for (const c of comps) {
        if (c.isDeduction || c.period !== 'daily') continue
        const it = (items || []).find((i: any) => i.employee_id === l.employee_id && i.kind === c.kind && i.label === c.label && i.period === 'daily')
        const f = halfFactor(it?.half_day_policy)
        const savedQty = Number(l.days_present || 0) + Number(l.days_half || 0) * f
        // The owner typed a different count in — theirs to keep, but say so
        if (Math.abs(Number(c.qty || 0) - savedQty) > 1e-9) { leftAsTyped.push(c.label || c.kind); continue }
        c.qty = present + half * f
        c.amount = r0((Number(c.rate) || 0) * c.qty)
      }
      const baseEarned = comps.filter((c: any) => c.kind === 'base' && !c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
      for (const c of comps) if (c.kind === 'epf' && c.unit === 'percent') c.amount = r0(baseEarned * (Number(c.rate) || 0) / 100)
      Object.assign(l, { days_present: present, days_half: half, days_absent: absent, payable_days: present + half * 0.5 })
    }
    const gross = comps.filter((c: any) => !c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
    const deductions = comps.filter((c: any) => c.isDeduction).reduce((t: number, c: any) => t + r0(c.amount), 0)
    Object.assign(l, { components: comps, gross, deductions, advances: advance, net_pay: gross - deductions - advance })

    const parts: string[] = []
    if (daysChanged) parts.push(`days worked ${days(before.payable)} → ${days(Number(l.payable_days))}`)
    if (advChanged) parts.push(`advances ${rsText(before.adv)} → ${rsText(advance)}`)
    let msg = `${l.employee_name}: ${parts.join(', ')} — ` + (r0(l.net_pay) === before.net ? 'pay unchanged' : `pay ${rsText(before.net)} → ${rsText(r0(l.net_pay))}`)
    if (leftAsTyped.length) msg += ` (${leftAsTyped.join(', ')} left as you typed ${leftAsTyped.length === 1 ? 'it' : 'them'} — check)`
    out.push(msg)
  }
  return out
}

