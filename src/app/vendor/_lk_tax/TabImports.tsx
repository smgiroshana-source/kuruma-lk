'use client'
// ── WHEEL MART ONLY — import shipments (Customs declarations + import VAT) ──
//
// The data-entry home for "a container arrived". Import VAT is claimed on the
// Cusdec, never on individual parts, so nothing here depends on product costs:
// goods go in through Bulk Upload (cost optional), the VAT is claimed here.

import { useState, useEffect, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'

type Entry = {
  id: string
  cusdec_no: string; cusdec_date: string; cusdec_serial_id: string | null
  cusdec_reg_date: string | null; cusdec_office_id: string | null
  vat_upfront: number; vat_deferred: number; disallowed_vat: number
  supplier: string | null; reference: string | null; notes: string | null
  vat_claim_period: string | null
  claimable: number; originMonth: string; claimPeriod: string
  expiryMonth: string; monthsLeft: number; deferred: boolean; claimed: boolean
}

const blank = () => ({
  cusdecNo: '', cusdecDate: colomboToday(), cusdecSerialId: 'I', cusdecRegDate: '',
  cusdecOfficeId: '', vatUpfront: '', vatDeferred: '', disallowedVat: '',
  supplier: '', reference: '', notes: '',
})

const rs = (n: number) => 'Rs.' + Math.round(n || 0).toLocaleString()
const nextMonthOf = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function TabImports({ showToast }: { showToast: (m: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [totals, setTotals] = useState<any>({ count: 0, claimable: 0, pending: 0, expiringSoon: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(blank())
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/vendor/import-vat')
      if (r.ok) { const j = await r.json(); setEntries(j.entries || []); setTotals(j.totals || {}) }
    } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (payload: any, okMsg: string) => {
    try {
      const r = await fetch('/api/vendor/import-vat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast(okMsg)
      load()
      return true
    } catch (e: any) { showToast('⚠️ ' + e.message); return false }
  }

  const save = async () => {
    if (!form.cusdecNo.trim()) { showToast('Enter the Cusdec number'); return }
    if (!form.cusdecDate) { showToast('Enter the Cusdec date'); return }
    if (!(Number(form.vatUpfront) > 0 || Number(form.vatDeferred) > 0)) { showToast('Enter the VAT paid on this declaration'); return }
    setSaving(true)
    const ok = await post({ action: 'add', entry: form }, `✅ Cusdec ${form.cusdecNo} recorded`)
    if (ok) { setForm(blank()); setShowForm(false) }
    setSaving(false)
  }

  // IRD Schedule 03 CSV, straight from the portal (dates arrive as M/D/YYYY)
  const uploadCsv = async (file: File) => {
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { showToast('That file has no rows'); return }
    const toIso = (d: string) => {
      const p = d.trim().split('/')
      return p.length === 3 ? `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}` : d.trim()
    }
    const num = (v: string) => Math.round(Number(String(v || '').replace(/["\s,]/g, '')) || 0)
    const rows = lines.slice(1).map(line => {
      const c = line.split(',')
      return {
        cusdecDate: toIso(c[1] || ''), cusdecNo: (c[2] || '').trim(),
        cusdecSerialId: (c[3] || '').trim(), cusdecRegDate: toIso(c[4] || ''),
        cusdecOfficeId: (c[5] || '').trim(),
        vatDeferred: num(c[6]), vatUpfront: num(c[7]), disallowedVat: num(c[8]),
      }
    }).filter(e => e.cusdecNo)
    if (rows.length === 0) { showToast('No Cusdec rows found — is this a Schedule 03 file?'); return }
    await post({ action: 'add', entries: rows }, `✅ ${rows.length} declaration(s) imported`)
  }

  const exportCsv = () => {
    const head = 'Serial No,Cusdec Date,Cusdec No,Cusdec Serial ID,Cusdec Reg Date,Cusdec Office ID,VAT Deferred,VAT Upfront,Disallowed VAT'
    const mdy = (d: string) => { const p = String(d || '').split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}/${p[0]}` : d }
    const body = entries.map((r, i) => [
      i + 1, mdy(r.cusdec_date), r.cusdec_no, r.cusdec_serial_id || '', mdy(r.cusdec_reg_date || r.cusdec_date),
      r.cusdec_office_id || '', Number(r.vat_deferred).toFixed(2), r.vat_upfront, Number(r.disallowed_vat).toFixed(2),
    ].join(',')).join('\n')
    const blob = new Blob([head + '\n' + body + '\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `VAT_SCHEDULE03_${colomboToday()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading shipments…</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-black text-slate-900">🚢 Import Shipments</h1>
          <p className="text-sm text-slate-400 mt-0.5">Customs declarations and the import VAT paid on them</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <label className="text-xs font-bold px-3.5 py-2.5 rounded-lg border-2 border-sky-300 bg-white text-sky-700 hover:bg-sky-50 cursor-pointer">
            ⬆ Upload IRD Schedule 03
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCsv(f) }} />
          </label>
          {entries.length > 0 && (
            <button onClick={exportCsv} className="text-xs font-bold px-3.5 py-2.5 rounded-lg border-2 border-slate-200 bg-white text-slate-600 hover:bg-slate-50">⬇ Export CSV</button>
          )}
          <button onClick={() => { setForm(blank()); setShowForm(!showForm) }}
            className="text-xs font-bold px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white">
            {showForm ? 'Cancel' : '+ Add Declaration'}
          </button>
        </div>
      </div>

      {/* How this fits together — the question everyone asks once */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl p-3.5 mb-4">
        <p className="text-[11px] text-sky-900 leading-relaxed">
          <strong>Goods</strong> go in through <strong>Bulk Upload</strong> (cost optional — thousands of parts need no individual cost).
          <strong> Import VAT</strong> is claimed here, on the Customs declaration, so the two never depend on each other.
          Credits can be claimed up to <strong>24 months</strong> after the Cusdec.
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { l: 'Declarations', v: String(totals.count || 0), c: 'text-slate-800' },
          { l: 'Import VAT recorded', v: rs(totals.claimable || 0), c: 'text-sky-700' },
          { l: 'Waiting for later months', v: rs(totals.pending || 0), c: 'text-amber-600' },
          { l: 'Expiring within 3 months', v: String(totals.expiringSoon || 0), c: (totals.expiringSoon || 0) > 0 ? 'text-red-600' : 'text-slate-400' },
        ].map(s => (
          <div key={s.l} className="bg-white rounded-xl border border-slate-200 p-3.5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{s.l}</p>
            <p className={`text-lg font-black mt-0.5 ${s.c}`}>{s.v}</p>
          </div>
        ))}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="bg-white rounded-xl border-2 border-orange-200 p-5 mb-4">
          <h3 className="font-bold text-sm text-slate-800 mb-3">New Customs Declaration</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Cusdec No *</label>
              <input value={form.cusdecNo} onChange={e => setForm({ ...form, cusdecNo: e.target.value })} placeholder="39436"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Cusdec Date *</label>
              <input type="date" value={form.cusdecDate} onChange={e => setForm({ ...form, cusdecDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Office ID</label>
              <input value={form.cusdecOfficeId} onChange={e => setForm({ ...form, cusdecOfficeId: e.target.value })} placeholder="HBIM1"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">VAT Upfront (Rs.) *</label>
              <input type="number" inputMode="numeric" value={form.vatUpfront} onChange={e => setForm({ ...form, vatUpfront: e.target.value })} placeholder="2279395"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">VAT Deferred (Rs.)</label>
              <input type="number" inputMode="numeric" value={form.vatDeferred} onChange={e => setForm({ ...form, vatDeferred: e.target.value })} placeholder="0"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Disallowed VAT (Rs.)</label>
              <input type="number" inputMode="numeric" value={form.disallowedVat} onChange={e => setForm({ ...form, disallowedVat: e.target.value })} placeholder="0"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Supplier / shipper</label>
              <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} placeholder="optional"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Container / reference</label>
              <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="e.g. MRKU4535257"
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" /></div>
            <div><label className="block text-[11px] font-bold text-slate-500 mb-1">Notes</label>
              <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
          </div>
          <button onClick={save} disabled={saving}
            className="mt-4 px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-50">
            {saving ? 'Saving…' : '✓ Save Declaration'}
          </button>
        </div>
      )}

      {/* List */}
      {entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl opacity-30">🚢</p>
          <p className="text-sm font-semibold text-slate-400 mt-2">No shipments recorded yet</p>
          <p className="text-xs text-slate-400 mt-1">Upload the IRD Schedule 03 file, or add a declaration by hand.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {entries.map(e => (
            <div key={e.id} className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-bold text-sm text-slate-800">
                  <span className="font-mono">{e.cusdec_no}</span>
                  <span className="text-slate-400 font-normal"> · {e.cusdec_date}</span>
                  {e.cusdec_office_id && <span className="text-slate-400 font-normal"> · {e.cusdec_office_id}</span>}
                </p>
                <p className="text-[11px] text-slate-400">
                  {e.supplier ? e.supplier + ' · ' : ''}{e.reference ? e.reference + ' · ' : ''}
                  upfront {rs(e.vat_upfront)}{Number(e.vat_deferred) > 0 ? ` · deferred ${rs(e.vat_deferred)}` : ''}
                  {Number(e.disallowed_vat) > 0 ? ` · disallowed ${rs(e.disallowed_vat)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <p className="font-black text-sm text-sky-700 font-mono">{rs(e.claimable)}</p>
                  <p className={`text-[10px] font-bold ${e.deferred ? 'text-amber-600' : 'text-slate-400'}`}>
                    {e.deferred ? `claim in ${e.claimPeriod}` : `claimed ${e.originMonth}`}
                    <span className={e.monthsLeft <= 3 ? ' text-red-600' : ''}> · {e.monthsLeft}m left</span>
                  </p>
                </div>
                <button onClick={() => post({ action: 'set_claim_period', id: e.id, period: e.deferred ? null : nextMonthOf(e.claimPeriod) }, e.deferred ? 'Claimed in its own month' : 'Moved to the next month')}
                  className="text-[11px] font-bold text-amber-600 hover:text-amber-700 whitespace-nowrap">
                  {e.deferred ? '↩ claim now' : '→ next month'}
                </button>
                <button onClick={() => { if (confirmDel !== e.id) { setConfirmDel(e.id); setTimeout(() => setConfirmDel(c => c === e.id ? null : c), 3000); return } post({ action: 'delete', id: e.id }, 'Declaration removed'); setConfirmDel(null) }}
                  className={`text-xs font-bold ${confirmDel === e.id ? 'text-red-600 bg-red-50 px-2 py-1 rounded' : 'text-red-300'}`}>
                  {confirmDel === e.id ? 'Delete?' : '✕'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
