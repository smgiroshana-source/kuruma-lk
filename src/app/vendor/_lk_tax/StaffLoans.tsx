'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Staff loans — WHEEL MART, owner only (owner, 2026-09-23)
//
// Money lent to a person and taken back from salary a fixed instalment a
// month. Payroll proposes the instalment (or what's left, if less) as a
// "Loan repayment" line; the owner can lower it or type 0 to skip a month,
// and payday records what actually came off. Balances live in
// src/lib/staffLoans.ts. A drawer or bank loan enters the cash book like an
// advance does.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { colomboToday } from '@/lib/dates'

type Props = {
  employees: { id: string; name: string; active?: boolean }[]
  loans: any[]
  post: (body: any) => Promise<any>
  reload: () => void
  toast: (m: string) => void
}

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

export default function StaffLoans({ employees, loans, post, reload, toast }: Props) {
  const [emp, setEmp] = useState('')
  const [amount, setAmount] = useState('')
  const [instalment, setInstalment] = useState('')
  const [source, setSource] = useState<'drawer' | 'bank' | 'owner'>('drawer')
  const [date, setDate] = useState(colomboToday())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const amt = Math.round(Number(amount) || 0)
  const inst = Math.round(Number(instalment) || 0)
  const months = amt > 0 && inst > 0 ? Math.ceil(amt / inst) : 0
  const empName = (id: string) => employees.find(e => e.id === id)?.name || '—'

  async function add() {
    if (inst > amt) { toast('⚠️ The instalment is more than the loan'); return }
    setSaving(true)
    try {
      await post({ action: 'add_loan', employee_id: emp, amount: amt, instalment: inst, source, date, note })
      toast('✅ Loan recorded' + (source === 'drawer' ? ' — added to cash expenses' : ''))
      setAmount(''); setInstalment(''); setNote('')
      reload()
    } catch (e: any) { toast('❌ ' + e.message) }
    setSaving(false)
  }

  async function remove(id: string) {
    if (confirmDel !== id) { setConfirmDel(id); setTimeout(() => setConfirmDel(c => c === id ? null : c), 3000); return }
    try { await post({ action: 'delete_loan', id }); setConfirmDel(null); toast('Loan removed'); reload() }
    catch (e: any) { toast('❌ ' + e.message) }
  }

  const open = loans.filter(l => l.balance > 0)
  const cleared = loans.filter(l => l.balance <= 0)

  return (
    <div className="mb-4">
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Give Staff Loan</p>
        <div className="grid sm:grid-cols-5 gap-2">
          <select value={emp} onChange={e => setEmp(e.target.value)} className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
            <option value="">Select person…</option>
            {employees.filter(e => e.active !== false).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="number" inputMode="numeric" min="0" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Loan Rs."
            className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400" />
          <input type="number" inputMode="numeric" min="0" value={instalment} onChange={e => setInstalment(e.target.value)} placeholder="Per month Rs."
            className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400" />
          <select value={source} onChange={e => setSource(e.target.value as any)} className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
            <option value="drawer">💵 From drawer (hits cash)</option>
            <option value="bank">🏦 From bank</option>
            <option value="owner">👤 Owner&apos;s own money</option>
          </select>
          <button onClick={add} disabled={saving || !emp || amt <= 0 || inst <= 0}
            className="py-2.5 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-40">{saving ? '…' : 'Record loan'}</button>
        </div>
        <div className="grid sm:grid-cols-5 gap-2 mt-2">
          <input type="date" value={date} max={colomboToday()} onChange={e => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
            className="sm:col-span-4 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">
          {months > 0
            ? <>Repaid over about <strong className="text-slate-600">{months} month{months !== 1 ? 's' : ''}</strong>, starting with the first payroll after the loan date. </>
            : 'Repayment starts with the first payroll after the loan date. '}
          Each month you can lower the repayment or skip it in Payroll — the balance just waits.
        </p>
      </div>

      {(open.length > 0 || cleared.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {[...open, ...cleared].map(l => (
            <div key={l.id} className={'flex items-center justify-between px-4 py-2.5 ' + (l.balance <= 0 ? 'opacity-50' : '')}>
              <div className="min-w-0">
                <span className="text-sm font-bold text-slate-700">{empName(l.employee_id)}</span>
                <span className="text-xs text-slate-400 ml-2">
                  Loan {rs(l.amount)} on {l.date} · {rs(l.instalment)}/month · repaid {rs(l.repaid)}{l.note ? ` · ${l.note}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-right">
                  <span className="block font-mono font-bold text-sm text-slate-800">{l.balance > 0 ? rs(l.balance) : '✓ cleared'}</span>
                  {l.balance > 0 && <span className="block text-[10px] text-slate-400">still owed</span>}
                </span>
                {l.repayment_count === 0 && (
                  <button onClick={() => remove(l.id)}
                    className={`text-xs font-bold ${confirmDel === l.id ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-red-400'}`}>{confirmDel === l.id ? 'Delete?' : '✕'}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
