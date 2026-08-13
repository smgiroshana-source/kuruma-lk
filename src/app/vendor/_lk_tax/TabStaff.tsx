'use client'

// WHEEL MART Staff / HR — stage 1: registry (one list for shop + workshop),
// per-item pay visibility, daily attendance, staff advances.
// Pay items are OWNER-ONLY unless the owner flags an item visible; the server
// (api/vendor/staff-hr) omits hidden items from manager responses entirely.

import { useState, useEffect, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'
import { isValidSLPhone, PHONE_FORMAT_MSG } from '@/lib/phone'
import { createClient } from '@/lib/supabase/client'
import { compressImage } from '@/lib/compressImage'
import { escapeHtml } from '@/lib/escapeHtml'

type PayItem = {
  id?: string; kind: string; label: string; amount: number | string
  unit: 'rs' | 'percent'; period: 'monthly' | 'daily' | 'per_event'
  half_day_policy: 'half' | 'none' | 'full'; visible_to_office: boolean
}
type Employee = {
  id: string; name: string; nic: string | null; phone: string | null; address: string | null
  branch: 'shop' | 'workshop'; join_date: string | null; pay_type: string; active: boolean
  pay_items: PayItem[]
}

const PAY_PRESETS: Omit<PayItem, 'visible_to_office'>[] = [
  { kind: 'base', label: 'Base salary', amount: '', unit: 'rs', period: 'monthly', half_day_policy: 'half' },
  { kind: 'allowance', label: 'Food allowance', amount: '', unit: 'rs', period: 'daily', half_day_policy: 'half' },
  { kind: 'allowance', label: 'Travel allowance', amount: '', unit: 'rs', period: 'daily', half_day_policy: 'half' },
  { kind: 'commission_rate', label: 'Tyre repair', amount: '', unit: 'rs', period: 'per_event', half_day_policy: 'half' },
  { kind: 'commission_rate', label: 'Night wheel alignment', amount: '', unit: 'rs', period: 'per_event', half_day_policy: 'half' },
  { kind: 'commission_rate', label: 'Suspension / camber adj.', amount: '', unit: 'rs', period: 'per_event', half_day_policy: 'half' },
  { kind: 'profit_rate', label: 'Workshop profit share', amount: '', unit: 'percent', period: 'monthly', half_day_policy: 'half' },
  { kind: 'epf', label: 'EPF deduction (manual)', amount: '', unit: 'rs', period: 'monthly', half_day_policy: 'half' },
]

export default function TabStaff({ staffRole, initialView, onInitialViewConsumed }: { staffRole: string; initialView?: string | null; onInitialViewConsumed?: () => void }) {
  const isOwner = staffRole === 'owner'
  const [view, setView] = useState<'people' | 'attendance' | 'advances'>(
    initialView === 'attendance' || initialView === 'advances' ? initialView : 'people'
  )
  useEffect(() => { if (initialView && onInitialViewConsumed) onInitialViewConsumed() }, [initialView, onInitialViewConsumed])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [scope, setScope] = useState<string>('both')
  const [advances, setAdvances] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const tt = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }

  // Attendance
  const [attDate, setAttDate] = useState(colomboToday())
  const [attMarks, setAttMarks] = useState<Record<string, string>>({})
  const [attSaving, setAttSaving] = useState(false)

  // Employee editor
  const [editing, setEditing] = useState<any>(null) // null | {employee fields + pay_items + id_photos}
  const [saving, setSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState(false)

  const handleIdUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setUploadingId(true)
    try {
      const compressed = await compressImage(file, 250)
      const fd = new FormData()
      fd.append('file', compressed)
      const r = await fetch('/api/vendor/staff-hr', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error || 'Upload failed')
      setEditing((e: any) => ({ ...e, id_photos: [...(e.id_photos || []), j.url] }))
      tt('📷 ID copy added')
    } catch (e: any) { tt('❌ ' + e.message) }
    setUploadingId(false)
  }

  // Advance form
  const [advEmp, setAdvEmp] = useState('')
  const [advAmt, setAdvAmt] = useState('')
  const [advSource, setAdvSource] = useState<'drawer' | 'bank' | 'owner'>('drawer')
  const [advNote, setAdvNote] = useState('')
  const [advSaving, setAdvSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = useCallback(async (date?: string) => {
    try {
      const r = await fetch(`/api/vendor/staff-hr?date=${date || attDate}`)
      if (!r.ok) { setLoading(false); return }
      const j = await r.json()
      setEmployees(j.employees || [])
      setScope(j.scope || 'both')
      setAdvances(j.advances || [])
      const marks: Record<string, string> = {}
      for (const a of (j.attendance || [])) marks[a.employee_id] = a.status
      setAttMarks(marks)
    } catch {}
    setLoading(false)
  }, [attDate])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => {
    let r = await fetch('/api/vendor/staff-hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.status === 401) {
      // Session token expired while the form was open — refresh it client-side
      // and retry once, so the typed entry isn't lost to a "Not authenticated"
      try { await createClient().auth.refreshSession() } catch {}
      r = await fetch('/api/vendor/staff-hr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.status === 401) {
        tt('⚠️ Session expired — reloading, please sign in and re-enter')
        setTimeout(() => window.location.reload(), 2000)
        throw new Error('Session expired')
      }
    }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Failed')
    return j
  }

  const saveEmployee = async () => {
    if (!editing?.name?.trim()) { tt('⚠️ Name required'); return }
    // NIC is the identity key — required, and never registered twice
    const nicNorm = String(editing.nic || '').trim().toUpperCase().replace(/\s+/g, '')
    if (!nicNorm) { tt('⚠️ NIC / ID number is required'); return }
    const clash = employees.find(e => e.id !== editing.id && String(e.nic || '').trim().toUpperCase().replace(/\s+/g, '') === nicNorm)
    if (clash) { tt(`⚠️ That NIC is already registered to ${clash.name}`); return }
    if (editing.phone?.trim() && !isValidSLPhone(editing.phone)) { tt('⚠️ ' + PHONE_FORMAT_MSG); return }
    if ((editing.id_photos || []).length === 0) { tt('⚠️ Add at least one ID copy photo'); return }
    setSaving(true)
    try {
      const j = await post({ action: 'upsert_employee', ...editing })
      // Remember the new id immediately: if the pay-items step below fails and
      // the user hits Save again, this must UPDATE the person just created —
      // otherwise every retry registers another duplicate.
      if (!editing.id && j.employee?.id) setEditing((e: any) => ({ ...e, id: j.employee.id }))
      if (isOwner) {
        const payItems = (editing.pay_items || []).filter((i: PayItem) => i.label.trim() && Number(i.amount) > 0)
        await post({
          action: 'set_pay_items', employee_id: j.employee.id, items: payItems,
          // deliberate clear = the record HAD items and the owner removed them here
          clear_all: payItems.length === 0 && (editing._origItemCount || 0) > 0,
        })
      }
      tt('✅ Saved')
      setEditing(null)
      load()
    } catch (e: any) { tt('❌ ' + e.message) }
    setSaving(false)
  }

  // ── Period attendance report (PDF for the owner) ──
  const [repFrom, setRepFrom] = useState(() => colomboToday().slice(0, 8) + '01')
  const [repTo, setRepTo] = useState(colomboToday())
  const [repBusy, setRepBusy] = useState(false)

  const generateAttendanceReport = async () => {
    if (repFrom > repTo) { tt('⚠️ Start date is after the end date'); return }
    setRepBusy(true)
    try {
      const r = await fetch(`/api/vendor/staff-hr?from=${repFrom}&to=${repTo}`)
      if (!r.ok) throw new Error('Could not load attendance')
      const j = await r.json()
      const emps: Employee[] = j.employees || []
      const marks: any[] = j.attendance || []

      // Every date in the range (Colombo dates, no timezone drift)
      const days: string[] = []
      for (let d = new Date(repFrom + 'T00:00:00'); d <= new Date(repTo + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        days.push(d.toLocaleDateString('en-CA'))
      }
      const byEmpDate = new Map(marks.map((m: any) => [m.employee_id + '|' + m.date, m.status]))
      const LETTER: Record<string, string> = { present: 'P', half: '½', absent: 'A' }
      const COLOR: Record<string, string> = { present: '#16a34a', half: '#d97706', absent: '#dc2626' }

      const people = emps.filter(e => !(e.join_date && e.join_date > repTo))
      const rows = people.map(e => {
        let p = 0, h = 0, a = 0, unmarked = 0
        const cells = days.map(d => {
          if (e.join_date && d < e.join_date) return '<td style="background:#f8fafc;color:#cbd5e1">·</td>'
          const st = byEmpDate.get(e.id + '|' + d)
          if (st === 'present') p++; else if (st === 'half') h++; else if (st === 'absent') a++; else unmarked++
          return st
            ? `<td style="color:${COLOR[st]};font-weight:700">${LETTER[st]}</td>`
            : '<td style="color:#e2e8f0">—</td>'
        }).join('')
        const payable = p + h * 0.5
        return { html: `<tr><td class="nm">${escapeHtml(e.name)}<div class="br">${escapeHtml(e.branch)}</div></td>${cells}<td class="tot">${p}</td><td class="tot">${h}</td><td class="tot" style="color:#dc2626">${a}</td><td class="tot" style="color:#94a3b8">${unmarked}</td><td class="tot" style="background:#f1f5f9">${payable}</td></tr>` }
      }).map(r => r.html).join('')

      const dayHead = days.map(d => `<th class="dh">${d.slice(8)}</th>`).join('')
      const html = `<!DOCTYPE html><html><head><title>Attendance ${repFrom} to ${repTo}</title><style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px;color:#0f172a}
        h1{font-size:20px;margin:0}
        .sub{color:#64748b;font-size:13px;margin:2px 0 16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #e2e8f0;padding:4px 3px;text-align:center}
        th{background:#f8fafc;font-size:10px;color:#475569}
        .dh{width:18px}
        .nm{text-align:left;font-weight:700;font-size:12px;white-space:nowrap;padding-right:8px}
        .br{font-weight:400;font-size:9px;color:#94a3b8;text-transform:uppercase}
        .tot{font-weight:700;background:#fafafa}
        .legend{margin-top:12px;font-size:11px;color:#64748b}
        .print-btn{position:fixed;top:12px;right:12px;padding:10px 18px;background:#f97316;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer}
        @media print{.print-btn{display:none}body{padding:0}}
      </style></head><body>
        <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
        <h1>Staff Attendance</h1>
        <div class="sub">MacForce Auto Engineering · ${repFrom} to ${repTo} · ${people.length} staff</div>
        <table><thead><tr><th class="nm">Name</th>${dayHead}<th class="tot">P</th><th class="tot">½</th><th class="tot">A</th><th class="tot">—</th><th class="tot">Payable days</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="99" style="padding:20px;color:#94a3b8">No staff in this period</td></tr>'}</tbody></table>
        <div class="legend">P = present · ½ = half day · A = absent · — = not marked · · = before joining. Payable days = present + half×0.5.</div>
      </body></html>`

      const w = window.open('', '_blank')
      if (!w) { tt('⚠️ Pop-ups blocked — allow pop-ups and try again'); setRepBusy(false); return }
      w.document.write(html)
      w.document.close()
    } catch (e: any) { tt('❌ ' + e.message) }
    setRepBusy(false)
  }

  const saveAttendance = async () => {
    const marks = employees
      .filter(e => e.active && attMarks[e.id] && !(e.join_date && attDate < e.join_date))
      .map(e => ({ employee_id: e.id, status: attMarks[e.id] }))
    if (marks.length === 0) { tt('⚠️ Mark at least one person'); return }
    setAttSaving(true)
    try { await post({ action: 'mark_attendance', date: attDate, marks }); tt(`✅ Attendance saved (${marks.length})`) } catch (e: any) { tt('❌ ' + e.message) }
    setAttSaving(false)
  }

  const addAdvance = async () => {
    setAdvSaving(true)
    try {
      await post({ action: 'add_advance', employee_id: advEmp, amount: advAmt, source: advSource, note: advNote })
      tt('✅ Advance recorded' + (advSource === 'drawer' ? ' — added to cash expenses' : ''))
      setAdvAmt(''); setAdvNote('')
      load()
    } catch (e: any) { tt('❌ ' + e.message) }
    setAdvSaving(false)
  }

  const empName = (id: string) => employees.find(e => e.id === id)?.name || '—'
  const branchChip = (b: string) => b === 'workshop' ? <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">WORKSHOP</span> : <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">SHOP</span>

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading staff…</div>

  return (
    <div>
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">Staff
          {scope !== 'both' && <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase">{scope} only</span>}
        </h2>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {(['people', 'attendance', 'advances'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} className={`px-3.5 py-1.5 rounded-lg text-xs font-bold capitalize transition ${view === v ? 'bg-white shadow text-slate-800' : 'text-slate-500'}`}>{v}</button>
          ))}
        </div>
      </div>

      {/* ── PEOPLE ── */}
      {view === 'people' && (
        <>
          <button onClick={() => setEditing({ name: '', nic: '', phone: '', address: '', branch: scope === 'workshop' ? 'workshop' : 'shop', join_date: '', pay_type: 'monthly', active: true, pay_items: [], id_photos: [] })}
            className="mb-3 px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-bold hover:bg-orange-600">+ Register Staff Member</button>
          {employees.length === 0 && <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">No staff registered yet</div>}
          <div className="grid sm:grid-cols-2 gap-3">
            {employees.map(e => (
              <div key={e.id} className={`bg-white rounded-xl border p-4 ${e.active ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-slate-800 flex items-center gap-2">{e.name} {branchChip(e.branch)}{!e.active && <span className="text-[10px] text-slate-400">INACTIVE</span>}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{e.pay_type} · {e.phone || 'no phone'}{e.nic ? ` · ${e.nic}` : ''}</div>
                  </div>
                  <button onClick={() => setEditing({ id: e.id, name: e.name, nic: e.nic || '', phone: e.phone || '', address: e.address || '', branch: e.branch, join_date: e.join_date || '', pay_type: e.pay_type, active: e.active, pay_items: (e.pay_items || []).map(i => ({ ...i })), _origItemCount: (e.pay_items || []).length, id_photos: Array.isArray((e as any).id_photos) ? [...(e as any).id_photos] : [] })}
                    className="text-xs font-bold text-orange-500 hover:text-orange-600">Edit</button>
                </div>
                {(e.pay_items || []).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
                    {e.pay_items.map((i, idx) => (
                      <span key={idx} className="text-[11px] px-2 py-0.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
                        {isOwner ? (i.visible_to_office ? '👁 ' : '🔒 ') : ''}{i.label}: {i.unit === 'percent' ? `${i.amount}%` : `Rs.${Number(i.amount).toLocaleString()}`}{i.period === 'daily' ? '/day' : i.period === 'per_event' ? '/job' : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── ATTENDANCE ── */}
      {view === 'attendance' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input type="date" value={attDate} max={colomboToday()} onChange={e => { setAttDate(e.target.value) }} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-semibold outline-none focus:border-orange-400" />
            <span className="text-xs text-slate-400">Present / Half day / Absent — allowances follow these marks</span>
          </div>
          {employees.filter(e => e.active && !(e.join_date && attDate < e.join_date)).length === 0 && (
            <p className="text-sm text-slate-400 py-4 text-center">Nobody was employed on this date.</p>
          )}
          {employees.filter(e => e.active && !(e.join_date && attDate < e.join_date)).map(e => (
            <div key={e.id} className="flex items-center justify-between py-2.5 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">{e.name} {branchChip(e.branch)}</div>
              <div className="flex gap-1.5">
                {[['present', 'P', 'bg-green-500'], ['half', '½', 'bg-amber-500'], ['absent', 'A', 'bg-red-500']].map(([val, label, color]) => (
                  <button key={val} onClick={() => setAttMarks(m => ({ ...m, [e.id]: val }))}
                    className={`w-10 h-10 rounded-lg text-sm font-black transition ${attMarks[e.id] === val ? color + ' text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{label}</button>
                ))}
              </div>
            </div>
          ))}
          <button onClick={saveAttendance} disabled={attSaving}
            className="mt-4 w-full py-3 rounded-xl bg-green-500 text-white text-sm font-black hover:bg-green-600 disabled:opacity-50">{attSaving ? 'Saving…' : `✓ Save Attendance — ${attDate}`}</button>

          {/* Period report for the owner */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">Attendance report</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={repFrom} max={colomboToday()} onChange={e => setRepFrom(e.target.value)}
                className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-semibold outline-none focus:border-orange-400" />
              <span className="text-xs text-slate-400">to</span>
              <input type="date" value={repTo} max={colomboToday()} onChange={e => setRepTo(e.target.value)}
                className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-semibold outline-none focus:border-orange-400" />
              <button onClick={generateAttendanceReport} disabled={repBusy}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold disabled:opacity-50">
                {repBusy ? 'Building…' : '📄 PDF report'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">Day-by-day grid per person with present / half / absent totals and payable days — save as PDF and send to the owner.</p>
          </div>
        </div>
      )}

      {/* ── ADVANCES ── */}
      {view === 'advances' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Give Staff Advance</p>
            <div className="grid sm:grid-cols-4 gap-2">
              <select value={advEmp} onChange={e => setAdvEmp(e.target.value)} className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
                <option value="">Select person…</option>
                {employees.filter(e => e.active).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <input type="number" inputMode="numeric" min="0" value={advAmt} onChange={e => setAdvAmt(e.target.value)} placeholder="Amount Rs." className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400" />
              <select value={advSource} onChange={e => setAdvSource(e.target.value as any)} className="px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
                <option value="drawer">💵 From drawer (hits cash)</option>
                <option value="bank">🏦 From bank</option>
                <option value="owner">👤 Owner&apos;s own money</option>
              </select>
              <button onClick={addAdvance} disabled={advSaving || !advEmp || !advAmt}
                className="py-2.5 rounded-lg bg-orange-500 text-white text-sm font-bold hover:bg-orange-600 disabled:opacity-40">{advSaving ? '…' : 'Record'}</button>
            </div>
            <input value={advNote} onChange={e => setAdvNote(e.target.value)} placeholder="Note (optional)" className="mt-2 w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
            <p className="text-[11px] text-slate-400 mt-2">Advances are deducted from salary at month end (payroll — stage 2). Drawer advances appear in Cash &amp; Expenses automatically.</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {advances.length === 0 && <div className="p-6 text-center text-sm text-slate-400">No advances recorded</div>}
            {advances.map(a => (
              <div key={a.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="text-sm font-bold text-slate-700">{empName(a.employee_id)}</span>
                  <span className="text-xs text-slate-400 ml-2">{a.date} · {a.source === 'drawer' ? '💵 drawer' : a.source === 'bank' ? '🏦 bank' : '👤 owner'}{a.note ? ` · ${a.note}` : ''}{a.settled_in_run ? ' · ✓ settled' : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-slate-800">Rs.{Number(a.amount).toLocaleString()}</span>
                  {isOwner && !a.settled_in_run && (
                    <button onClick={async () => { if (confirmDel !== a.id) { setConfirmDel(a.id); setTimeout(() => setConfirmDel(c => c === a.id ? null : c), 3000); return } try { await post({ action: 'delete_advance', id: a.id }); setConfirmDel(null); tt('Advance removed'); load() } catch (e: any) { tt('❌ ' + e.message) } }}
                      className={`text-xs font-bold ${confirmDel === a.id ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-red-400'}`}>{confirmDel === a.id ? 'Delete?' : '✕'}</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── EMPLOYEE EDITOR ── */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !saving && setEditing(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-2xl max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black mb-4">{editing.id ? 'Edit' : 'Register'} Staff Member</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="block text-xs font-bold text-slate-500 mb-1">Name *</label>
                <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">NIC / ID number *</label>
                <input value={editing.nic} onChange={e => setEditing({ ...editing, nic: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">Phone</label>
                <input value={editing.phone} onChange={e => setEditing({ ...editing, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">Joined</label>
                <input type="date" value={editing.join_date} onChange={e => setEditing({ ...editing, join_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">Branch</label>
                <div className="flex gap-2">{(['shop', 'workshop'] as const).map(b => (
                  <button key={b} onClick={() => setEditing({ ...editing, branch: b })} className={`flex-1 py-2 rounded-lg text-sm font-bold border-2 capitalize ${editing.branch === b ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-500'}`}>{b}</button>
                ))}</div></div>
              <div><label className="block text-xs font-bold text-slate-500 mb-1">Pay type</label>
                <div className="flex gap-2">{(['monthly', 'daily', 'contract'] as const).map(p => (
                  <button key={p} onClick={() => setEditing({
                    ...editing, pay_type: p,
                    // Base pay follows the pay type: daily worker → per-day rate
                    pay_items: (editing.pay_items || []).map((it: PayItem) => it.kind === 'base' ? { ...it, period: p === 'daily' ? 'daily' : 'monthly' } : it),
                  })} className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 capitalize ${editing.pay_type === p ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-500'}`}>{p}</button>
                ))}</div></div>
            </div>
            <div className="mt-3"><label className="block text-xs font-bold text-slate-500 mb-1">Address</label>
              <input value={editing.address} onChange={e => setEditing({ ...editing, address: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>

            {/* ID copies — compulsory */}
            <div className="mt-3">
              <label className="block text-xs font-bold text-slate-500 mb-1">NIC / ID copies * <span className="font-normal text-slate-400">(photo of the ID — at least one)</span></label>
              <div className="flex gap-2 flex-wrap items-center">
                {(editing.id_photos || []).map((u: string, i: number) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="ID copy" className="w-24 h-16 object-cover rounded-lg border border-slate-200 cursor-pointer" onClick={() => window.open(u, '_blank')} />
                    <button onClick={() => setEditing({ ...editing, id_photos: editing.id_photos.filter((_: any, x: number) => x !== i) })}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">✕</button>
                  </div>
                ))}
                <label className={`w-24 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer ${uploadingId ? 'opacity-50' : ''} ${(editing.id_photos || []).length === 0 ? 'border-red-300 bg-red-50' : 'border-slate-300'}`}>
                  <span className="text-lg leading-none">{uploadingId ? '⏳' : '📷'}</span>
                  <span className={`text-[9px] font-bold mt-0.5 ${(editing.id_photos || []).length === 0 ? 'text-red-400' : 'text-slate-400'}`}>{uploadingId ? 'Uploading…' : 'Add photo'}</span>
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingId} onChange={handleIdUpload} />
                </label>
              </div>
            </div>
            {editing.id && (
              <label className="flex items-center gap-2 mt-3 cursor-pointer">
                <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} className="rounded" />
                <span className="text-sm text-slate-600">Active (uncheck when someone leaves — history is kept)</span>
              </label>
            )}

            {/* Pay items — OWNER ONLY */}
            {isOwner && (
              <div className="mt-5 bg-slate-50 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Pay Items</p>
                  <span className="text-[10px] text-slate-400">🔒 owner-only · 👁 office can see</span>
                </div>
                <p className="text-[11px] text-slate-400 mb-3">Tap 🔒/👁 to choose what office staff may see. Hidden items are never sent to their devices.</p>
                {(editing.pay_items || []).map((it: PayItem, idx: number) => (
                  <div key={idx} className="bg-white rounded-lg border border-slate-200 p-2.5 mb-2">
                    <div className="flex gap-2 items-center">
                      <button onClick={() => { const items = [...editing.pay_items]; items[idx] = { ...it, visible_to_office: !it.visible_to_office }; setEditing({ ...editing, pay_items: items }) }}
                        title={it.visible_to_office ? 'Office staff CAN see this' : 'Owner only'}
                        className={`w-9 h-9 rounded-lg text-base shrink-0 ${it.visible_to_office ? 'bg-sky-100' : 'bg-slate-100'}`}>{it.visible_to_office ? '👁' : '🔒'}</button>
                      <input value={it.label} onChange={e => { const items = [...editing.pay_items]; items[idx] = { ...it, label: e.target.value }; setEditing({ ...editing, pay_items: items }) }}
                        className="flex-1 px-2.5 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 min-w-0" />
                      <input type="number" inputMode="numeric" min="0" value={it.amount} onChange={e => { const items = [...editing.pay_items]; items[idx] = { ...it, amount: e.target.value }; setEditing({ ...editing, pay_items: items }) }}
                        placeholder={it.unit === 'percent' ? '%' : 'Rs.'} className="w-24 px-2.5 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400" />
                      <button onClick={() => setEditing({ ...editing, pay_items: editing.pay_items.filter((_: any, i: number) => i !== idx) })} className="text-red-400 font-bold px-1">✕</button>
                    </div>
                    <div className="flex gap-2 mt-2 text-[11px] items-center flex-wrap">
                      <span className="text-slate-400">{it.kind.replace('_', ' ')} · {it.unit === 'percent' ? 'percent' : 'rupees'} ·</span>
                      <span className="flex items-center gap-1 text-slate-500">
                        {(['monthly', 'daily', 'per_event'] as const).map(p => (
                          <button key={p} onClick={() => { const items = [...editing.pay_items]; items[idx] = { ...it, period: p }; setEditing({ ...editing, pay_items: items }) }}
                            className={`px-1.5 py-0.5 rounded font-bold ${it.period === p ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{p === 'per_event' ? 'per job' : p}</button>
                        ))}
                      </span>
                      {it.kind === 'allowance' && (
                        <span className="flex items-center gap-1 text-slate-500">Half-day:
                          {(['half', 'none', 'full'] as const).map(p => (
                            <button key={p} onClick={() => { const items = [...editing.pay_items]; items[idx] = { ...it, half_day_policy: p }; setEditing({ ...editing, pay_items: items }) }}
                              className={`px-1.5 py-0.5 rounded font-bold ${it.half_day_policy === p ? 'bg-slate-800 text-white' : 'bg-slate-100'}`}>{p === 'half' ? '½' : p === 'none' ? '0' : 'full'}</button>
                          ))}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {PAY_PRESETS.filter(p => !(editing.pay_items || []).some((i: PayItem) => i.label === p.label)).map(p => (
                    <button key={p.label} onClick={() => setEditing({ ...editing, pay_items: [...(editing.pay_items || []), { ...p, period: p.kind === 'base' && editing.pay_type === 'daily' ? 'daily' : p.period, visible_to_office: false }] })}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-orange-400 hover:text-orange-500">+ {p.label}</button>
                  ))}
                  <button onClick={() => setEditing({ ...editing, pay_items: [...(editing.pay_items || []), { kind: 'other', label: '', amount: '', unit: 'rs', period: 'monthly', half_day_policy: 'half', visible_to_office: false }] })}
                    className="text-[11px] px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-orange-400 hover:text-orange-500">+ Custom item</button>
                </div>
              </div>
            )}
            {!isOwner && <p className="mt-4 text-[11px] text-slate-400">Pay details are managed by the owner.</p>}

            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditing(null)} disabled={saving} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500">Cancel</button>
              <button onClick={saveEmployee} disabled={saving} className="flex-[2] py-3 rounded-xl bg-orange-500 text-white text-sm font-black hover:bg-orange-600 disabled:opacity-50">{saving ? 'Saving…' : '✓ Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
