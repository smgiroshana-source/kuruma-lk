'use client'
// ── WHEEL MART ONLY — someone is leaving (owner, 2026-09-30) ─────────────────
//
// Records the last working day and why. The person stays on the payroll of the
// cycle they leave in — their final settlement: days up to the last day,
// monthly pay ÷ 25 × days worked (editable there), advances taken off, the
// loan balance proposed as far as the pay covers it and the rest decided on
// payday (write off, or keep as owed). Once that payroll is paid they go
// inactive; reopening it brings them back. Their POS login is separate —
// switch it off in Logins.

import { useState } from 'react'
import { colomboToday } from '@/lib/dates'

const REASONS: [string, string][] = [
  ['resigned', 'Resigned'], ['dismissed', 'Dismissed'], ['contract_ended', 'Contract ended'], ['other', 'Other'],
]

// The salary cycle a date falls in (25th → 24th), named by the month it ends
function cycleOf(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const end = day >= 25 ? new Date(y, m, 24) : new Date(y, m - 1, 24)
  return end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function StaffLeaving({ emp, post, toast, onDone }: {
  emp: any
  post: (body: any) => Promise<any>
  toast: (m: string) => void
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(emp?.left_on || colomboToday())
  const [reason, setReason] = useState(emp?.leave_reason || 'resigned')
  const [note, setNote] = useState(emp?.leave_note || '')
  const [busy, setBusy] = useState(false)
  if (!emp) return null

  async function save(cancel = false) {
    setBusy(true)
    try {
      await post({ action: 'set_leaving', employee_id: emp.id, left_on: cancel ? null : date, leave_reason: reason, leave_note: note })
      toast(cancel ? `${emp.name} is staying — leaving cancelled` : `✅ ${emp.name} leaves on ${date} — final pay in the ${cycleOf(date)} payroll`)
      onDone()
    } catch (e: any) { toast('❌ ' + e.message) }
    setBusy(false)
  }

  // Already settled and gone
  if (!emp.active && emp.left_on) {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Left on <b>{emp.left_on}</b>{emp.leave_reason ? ` · ${REASONS.find(r => r[0] === emp.leave_reason)?.[1] || emp.leave_reason}` : ''} — final pay done.
      </div>
    )
  }

  if (emp.left_on && !open) {
    return (
      <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5">
        <p className="text-sm font-bold text-amber-900">Leaving on {emp.left_on}{emp.leave_reason ? ` · ${REASONS.find(r => r[0] === emp.leave_reason)?.[1]}` : ''}</p>
        <p className="text-[11px] text-amber-800 mt-0.5">Final pay in the {cycleOf(emp.left_on)} payroll. They go inactive once it is paid.</p>
        <div className="flex gap-3 mt-2">
          <button onClick={() => setOpen(true)} className="text-xs font-bold text-amber-900 underline">Change</button>
          <button onClick={() => save(true)} disabled={busy} className="text-xs font-bold text-slate-500 underline">Not leaving after all</button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-3 w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:border-amber-300 hover:bg-amber-50">
        Staff leaving…
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-black text-amber-900 uppercase tracking-wider mb-2">Staff leaving</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold text-slate-600">Last working day
          <input type="date" value={date} min={emp.join_date || undefined} onChange={e => setDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white" />
        </label>
        <label className="text-[11px] font-bold text-slate-600">Reason
          <select value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
        className="mt-2 w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white" />
      <ul className="text-[11px] text-amber-900 mt-2 space-y-0.5 list-disc pl-4">
        <li>Final pay goes in the <b>{date ? cycleOf(date) : '…'}</b> payroll: days up to the last day{emp.pay_type === 'monthly' ? ', monthly pay ÷ 25 × days worked (you can change it there)' : ''}.</li>
        <li>Advances not yet deducted come off it; any loan balance is proposed too, and on payday you choose to write off or keep what the pay doesn&apos;t cover.</li>
        <li>Attendance stops after the last day. If they have a POS login, switch it off in <b>Logins</b>.</li>
      </ul>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-600 bg-white">Cancel</button>
        <button onClick={() => save(false)} disabled={busy || !date}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-black disabled:opacity-50">{busy ? '…' : 'Record leaving'}</button>
      </div>
    </div>
  )
}
