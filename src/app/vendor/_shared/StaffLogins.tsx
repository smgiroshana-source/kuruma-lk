'use client'
// ── Shared by both vendors — one place for everything about a staff LOGIN ────
//
// Username, password, role, branch scope and tax authority all live here, so
// the owner never has to remember which screen holds which switch. This is the
// login (who can sign in and what they can touch) — the Staff tab's People /
// Attendance / Payroll are about the person as an employee.

import { useState, useEffect, useCallback } from 'react'

type Staff = {
  id: string
  name: string
  username: string | null
  email: string | null
  role: string
  branch_scope?: string | null
  can_file_tax?: boolean
  pin?: string | null
}

const blankNew = { name: '', username: '', email: '', role: 'cashier', pin: '', password: '' }

export default function StaffLogins({ showToast, isLkTax, loginHost }: {
  showToast: (m: string) => void
  isLkTax?: boolean
  loginHost?: string
}) {
  const [list, setList] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ ...blankNew })
  const [openId, setOpenId] = useState<string | null>(null)
  const [pwFor, setPwFor] = useState<Staff | null>(null)
  const [pwValue, setPwValue] = useState('')
  const [handover, setHandover] = useState<{ name: string; username: string; password: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/vendor/settings?action=staff')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setList(j.staff || [])
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setLoading(false)
  }, [showToast])
  useEffect(() => { load() }, [load])

  async function post(body: any) {
    const r = await fetch('/api/vendor/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok || j.error) throw new Error(j.error || 'Failed')
    return j
  }

  async function addStaff() {
    if (!form.name.trim()) { showToast('Name required'); return }
    if (!form.username.trim()) { showToast('Username required'); return }
    setBusy(true)
    try {
      const j = await post({ action: 'add_staff', ...form })
      setHandover({ name: form.name, username: j.username || form.username, password: j.tempPassword })
      setForm({ ...blankNew }); setAdding(false)
      await load()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  async function patch(s: Staff, body: any, okMsg?: string) {
    setBusy(true)
    try {
      await post({ action: 'update_staff', staff_id: s.id, ...body })
      if (okMsg) showToast(okMsg)
      await load()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  async function savePassword() {
    if (!pwFor) return
    if (pwValue && pwValue.trim().length < 6) { showToast('Password must be at least 6 characters'); return }
    setBusy(true)
    try {
      const j = await post({ action: 'reset_staff_password', staff_id: pwFor.id, password: pwValue.trim() || undefined })
      setHandover({ name: pwFor.name, username: pwFor.username || pwFor.email || '', password: j.tempPassword })
      setPwFor(null); setPwValue('')
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  async function removeStaff(s: Staff) {
    if (!confirm(`Remove ${s.name}'s login? They will not be able to sign in.`)) return
    setBusy(true)
    try { await post({ action: 'remove_staff', staff_id: s.id }); showToast('Login removed'); await load() }
    catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  const host = loginHost || (typeof window !== 'undefined' ? window.location.host : '')

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-sm text-slate-800">Staff logins</h3>
          <p className="text-[11px] text-slate-400">Username, password, role and what each login can see — all here.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-black">
            + Add login
          </button>
        )}
      </div>

      {/* ── New login ── */}
      {adding && (
        <div className="bg-white rounded-xl border-2 border-orange-200 p-4 mb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Name <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sajith Perera"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Username <span className="text-red-500">*</span></label>
              <input value={form.username} autoCapitalize="none"
                onChange={e => setForm(f => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))}
                placeholder="sajith" maxLength={20}
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" />
              <p className="text-[10px] text-slate-400 mt-0.5">This is what they type to log in</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Password</label>
              <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Leave blank to generate one"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Role</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
                <option value="cashier">Cashier — POS, drawer, receiving</option>
                <option value="manager">Manager — everything except Settings</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Email <span className="font-normal text-slate-400">(optional)</span></label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Only for password reset by mail"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">PIN <span className="font-normal text-slate-400">(optional)</span></label>
              <input value={form.pin} onChange={e => setForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                placeholder="4 digits" maxLength={4}
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setAdding(false); setForm({ ...blankNew }) }}
              className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
            <button onClick={addStaff} disabled={busy}
              className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-50">
              {busy ? 'Creating…' : 'Create login'}
            </button>
          </div>
        </div>
      )}

      {/* ── Existing logins ── */}
      {loading ? (
        <div className="text-center py-8 text-sm text-slate-400">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          No staff logins yet — you&apos;re the sole owner.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {list.map(s => {
            const isOpen = openId === s.id
            return (
              <div key={s.id} className="border-b border-slate-100 last:border-0">
                <button onClick={() => setOpenId(isOpen ? null : s.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className="text-slate-300 text-xs w-3">{isOpen ? '▾' : '▸'}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800 truncate">{s.name}</span>
                    <span className="block text-[11px] font-mono text-slate-400 truncate">{s.username || s.email}</span>
                  </span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full shrink-0 ${s.role === 'manager' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                    {s.role}
                  </span>
                  {isLkTax && (
                    <span className="text-[10px] font-bold text-slate-400 shrink-0 capitalize hidden sm:inline">{s.branch_scope || 'shop'}</span>
                  )}
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50/70 space-y-3">
                    {/* Username */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Username</label>
                      <div className="flex gap-2">
                        <input
                          defaultValue={s.username || ''} key={s.username || s.id} autoCapitalize="none"
                          onBlur={e => {
                            const v = e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '')
                            if (v && v !== (s.username || '')) patch(s, { username: v }, `Username is now "${v}"`)
                          }}
                          placeholder="sajith"
                          className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400"
                        />
                        <button onClick={() => { setPwFor(s); setPwValue('') }}
                          className="px-3 py-2 rounded-lg border-2 border-slate-300 text-xs font-bold text-slate-700 hover:bg-white">
                          Set password
                        </button>
                      </div>
                    </div>

                    {/* Role */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Role</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([{ v: 'cashier', l: 'Cashier', d: 'POS, drawer, receiving' }, { v: 'manager', l: 'Manager', d: 'All but Settings' }] as const).map(r => (
                          <button key={r.v} disabled={busy} onClick={() => s.role !== r.v && patch(s, { role: r.v }, `${s.name} is now a ${r.l.toLowerCase()}`)}
                            className={`text-left px-3 py-2 rounded-lg border-2 transition ${s.role === r.v ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                            <span className="block text-xs font-black text-slate-800">{r.l}</span>
                            <span className="block text-[10px] text-slate-400">{r.d}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Branch scope + tax authority — WHEEL MART's two sides */}
                    {isLkTax && (
                      <>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Can see</label>
                          <div className="grid grid-cols-3 gap-1.5">
                            {([{ v: 'shop', l: 'Shop' }, { v: 'workshop', l: 'Workshop' }, { v: 'both', l: 'Both' }] as const).map(o => (
                              <button key={o.v} disabled={busy} onClick={() => (s.branch_scope || 'shop') !== o.v && patch(s, { branch_scope: o.v }, `${s.name} can see ${o.l.toLowerCase()}`)}
                                className={`py-2 rounded-lg border-2 text-xs font-bold transition ${(s.branch_scope || 'shop') === o.v ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                                {o.l}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button disabled={busy} onClick={() => patch(s, { can_file_tax: !(s.can_file_tax === true) }, 'Tax filing authority updated')}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold border-2 transition ${s.can_file_tax ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-400'}`}>
                          <span>🧾 Tax filing — the consolidated whole-company VAT/SSCL figures</span>
                          <span>{s.can_file_tax ? 'ON' : 'OFF'}</span>
                        </button>
                      </>
                    )}

                    <button onClick={() => removeStaff(s)} disabled={busy}
                      className="text-[11px] font-bold text-red-500 hover:text-red-700">Remove this login</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Set password ── */}
      {pwFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setPwFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Set password</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              {pwFor.name} · <span className="font-mono">{pwFor.username || pwFor.email}</span> — their current password stops working immediately.
            </p>
            <input value={pwValue} onChange={e => setPwValue(e.target.value)} placeholder="Type one, or leave blank to generate"
              className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" />
            <p className="text-[11px] text-slate-400 mt-1">At least 6 characters.</p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPwFor(null)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={savePassword} disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-50">
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hand-over card ── */}
      {handover && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setHandover(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">🔐</div>
              <h3 className="text-lg font-black text-slate-900">Login ready</h3>
              <p className="text-xs text-slate-400 mt-1">Share these with <strong>{handover.name}</strong></p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 space-y-3 mb-4">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Login page</p>
                <p className="text-sm font-mono font-semibold text-slate-700">{host}/login</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Username</p>
                <p className="text-sm font-mono font-semibold text-slate-700">{handover.username}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Password</p>
                <div className="flex items-center gap-2">
                  <p className="text-lg font-mono font-black text-orange-600 tracking-wider">{handover.password}</p>
                  <button onClick={() => { navigator.clipboard.writeText(handover.password); showToast('Copied') }}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600">copy</button>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4">
              This password is shown once. If they forget it, set a new one here — no email needed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const msg = encodeURIComponent(
                    `Hi ${handover.name},\n\nYour login is ready:\n\nLogin: https://${host}/login\nUsername: ${handover.username}\nPassword: ${handover.password}\n\nKeep this safe.`
                  )
                  window.open('https://wa.me/?text=' + msg, '_blank')
                }}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold text-sm py-2.5 rounded-xl">
                Send via WhatsApp
              </button>
              <button onClick={() => setHandover(null)} className="px-4 text-slate-500 text-sm font-semibold">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
