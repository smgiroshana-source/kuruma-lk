'use client'
// ── WHEEL MART ONLY — VAT Filing Centre ──────────────────────────────────────
//
// One screen for closing a taxable period: what you owe, which input credits to
// claim now versus park for later (with the 12/24-month deadlines enforced and
// counted down), and the four IRD schedule files to submit.
//
// The Pvt Ltd is ONE taxpayer — everything here is whole-company across the
// PART (shop) and REPR (workshop) streams. No branch filtering, ever.

import { useState, useEffect, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'

const rs = (n: number) => 'Rs.' + Math.round(n || 0).toLocaleString()
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const mdy = (d: string) => { const p = String(d || '').split('-'); return p.length === 3 ? `${Number(p[1])}/${Number(p[2])}/${p[0]}` : d }
const csvCell = (v: any) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// What goes in the schedules' free-text Description column. Owner's accountant
// will confirm the wording; "Auto parts" is the working default.
const DESCRIPTION = 'Auto parts'

export default function TabTax({ showToast, vendorSettings, onOpenRegisters }: {
  showToast: (m: string) => void
  vendorSettings?: any
  onOpenRegisters?: () => void
}) {
  const [period, setPeriod] = useState(colomboToday().slice(0, 7))
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveTo, setMoveTo] = useState(addMonths(colomboToday().slice(0, 7), 1))
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/vat-filing?period=${p}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setData(j)
      setSelected(new Set())
      setMoveTo(addMonths(p, 1))
    } catch (e: any) { showToast('⚠️ ' + e.message); setData(null) }
    setLoading(false)
  }, [showToast])
  useEffect(() => { load(period) }, [period, load])

  const key = (i: any) => `${i.kind}:${i.id}`
  const toggle = (i: any) => setSelected(s => {
    const n = new Set(s); const k = key(i)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const claimedNow: any[] = data?.input?.claimedNow || []
  const parkedLater: any[] = data?.input?.parkedLater || []
  const t = data?.totals || {}
  // Live: what the liability becomes if the ticked credits are pushed out
  const selectedVat = claimedNow.filter(i => selected.has(key(i))).reduce((s, i) => s + i.vat, 0)
  const projectedPayable = (t.netPayable ?? 0) + selectedVat
  const inRefundPosition = (t.netPayable ?? 0) < 0

  const moveCredits = async (items: any[], target: string | null) => {
    if (items.length === 0) { showToast('Nothing selected'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/vat-filing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move_credits', items: items.map(i => ({ kind: i.kind, id: i.id })), period: target }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast(target ? `✅ ${items.length} credit(s) moved to ${target}` : `✅ ${items.length} credit(s) claimed in this period`)
      load(period)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  // ── Schedule file generation (IRD column order, CSV like Schedule 03) ──
  const download = (name: string, head: string, rows: string[]) => {
    if (rows.length === 0) { showToast('Nothing to include for this period'); return }
    const blob = new Blob([head + '\n' + rows.join('\n') + '\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    // Filename left neutral — the accountant adds IRD's period code at upload
    a.download = `${vendorSettings?.tax_id || 'TIN'}_VAT_SCHEDULE${name}_${period.replace('-', '')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    showToast(`Schedule ${name} — ${rows.length} row(s)`)
  }

  const genSchedule01 = () => download('01',
    "Serial No,Invoice Date,Tax Invoice No,Purchaser's TIN,Name of the Purchaser,Description,Value of supply,VAT Amount",
    (data?.schedule01 || []).map((r: any, i: number) =>
      [i + 1, mdy(r.invoiceDate), r.taxInvoiceNo, r.purchaserTin, csvCell(r.purchaserName), DESCRIPTION, r.valueOfSupply, r.vatAmount].join(',')))

  const genSchedule02 = () => download('02',
    "Serial No,Invoice Date,Tax Invoice No,Supplier's TIN,Name of the Supplier,Description,Value of purchase,VAT Amount,Disallowed VAT Amount",
    claimedNow.filter(i => i.kind === 'local').map((r: any, i: number) =>
      [i + 1, mdy(r.invoiceDate), csvCell(r.invoiceNo), r.partyTin, csvCell(r.partyName), DESCRIPTION, r.value, r.vat, r.disallowedVat || 0].join(',')))

  const genSchedule03 = () => download('03',
    'Serial No,Cusdec Date,Cusdec No,Cusdec Serial ID,Cusdec Reg Date,Cusdec Office ID,VAT Deferred,VAT Upfront,Disallowed VAT',
    claimedNow.filter(i => i.kind === 'import').map((r: any, i: number) =>
      [i + 1, mdy(r.invoiceDate), r.ref, r.cusdecSerialId || '', mdy(r.cusdecRegDate || r.invoiceDate), r.cusdecOfficeId || '',
       Number(r.vatDeferred).toFixed(2), r.vatUpfront, Number(r.disallowedVat).toFixed(2)].join(',')))

  const genSchedule04 = () => download('04',
    'Serial No,TIN No,Invoice Date,Invoice No,Tax Credit / Tax Debit Note,Date of Tax Credit / Tax Debit Note,Tax Credit No. / Tax Debit Note No.,Value of Tax Credit Note / Tax Debit Note,VAT Amount,Issued By Me',
    (data?.schedule04 || []).map((r: any, i: number) =>
      [i + 1, r.tin, mdy(r.invoiceDate), r.invoiceNo, r.noteType, mdy(r.noteDate), r.noteNo, r.value, r.vatAmount, r.issuedByMe].join(',')))

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading period…</div>

  const row = (i: any, checkable: boolean) => (
    <div key={key(i)} className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-xs ${selected.has(key(i)) ? 'bg-amber-50' : ''}`}>
      {checkable && (
        <input type="checkbox" checked={selected.has(key(i))} onChange={() => toggle(i)} className="w-4 h-4 accent-amber-500 shrink-0" />
      )}
      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${i.kind === 'import' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
        {i.kind === 'import' ? 'IMPORT' : 'LOCAL'}
      </span>
      <span className="font-mono font-bold shrink-0">{i.ref}</span>
      <span className="flex-1 truncate text-slate-500">{i.partyName || i.invoiceNo || ''}</span>
      <span className={`shrink-0 text-[10px] font-bold ${i.monthsLeft <= 3 ? 'text-red-600' : 'text-slate-400'}`}>
        {i.monthsLeft <= 0 ? 'EXPIRED' : `${i.monthsLeft}m left`}
      </span>
      <span className="font-mono font-black w-24 text-right shrink-0">{rs(i.vat)}</span>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">🗂️ VAT Filing Centre</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Whole company — parts shop and workshop together, one TIN {vendorSettings?.tax_id ? `(${vendorSettings.tax_id})` : ''}
          </p>
        </div>
        <input type="month" value={period} onChange={e => setPeriod(e.target.value)} max={colomboToday().slice(0, 7)}
          className="px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold outline-none focus:border-orange-400" />
      </div>

      {/* ── The number that matters ── */}
      <div className={`rounded-xl border-2 p-5 mb-4 ${inRefundPosition ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">VAT payable for {period}</p>
            <p className={`text-3xl font-black mt-1 ${inRefundPosition ? 'text-red-600' : 'text-emerald-700'}`}>{rs(t.netPayable)}</p>
            {inRefundPosition && (
              <p className="text-xs font-bold text-red-700 mt-1">
                Negative — you&apos;d be claiming a refund. Push {rs(Math.abs(t.netPayable))} of input credits to a later month below.
              </p>
            )}
            {selectedVat > 0 && (
              <p className="text-xs font-bold text-amber-700 mt-1">
                With {rs(selectedVat)} moved out → payable becomes <span className="font-black">{rs(projectedPayable)}</span>
              </p>
            )}
          </div>
          <div className="text-right text-xs text-slate-600 space-y-0.5">
            <p>Output VAT: <span className="font-mono font-bold">{rs(t.outputVat)}</span> <span className="text-slate-400">({t.invoiceCount} invoices)</span></p>
            {t.crnVat > 0 && <p>Less credit notes: <span className="font-mono font-bold text-red-600">−{rs(t.crnVat)}</span></p>}
            <p>Input VAT claimed: <span className="font-mono font-bold">−{rs(t.inputVat)}</span></p>
            <p className="text-[11px] text-slate-400">local {rs(t.inputLocal)} · imports {rs(t.inputImport)}</p>
            {t.supplierCrnVat > 0 && (
              <p className="text-[11px]">Less supplier credit notes: <span className="font-mono font-bold text-red-600">+{rs(t.supplierCrnVat)}</span></p>
            )}
            {t.parkedTotal > 0 && <p className="text-[11px] text-amber-600">{rs(t.parkedTotal)} parked for later months</p>}
          </div>
        </div>
      </div>

      {/* ── Expiring soon ── */}
      {(data?.input?.expiringSoon || []).length > 0 && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 mb-4">
          <p className="text-xs font-black text-red-800 mb-2">
            ⏰ {data.input.expiringSoon.length} parked credit(s) close to expiry — claim them before the deadline or lose them
          </p>
          <div className="bg-white rounded-lg border border-red-200 overflow-hidden">
            {data.input.expiringSoon.map((i: any) => (
              <div key={key(i)} className="flex items-center gap-2 px-3 py-2 border-b border-red-50 text-xs">
                <span className="font-mono font-bold">{i.ref}</span>
                <span className="flex-1 truncate text-slate-500">{i.partyName}</span>
                <span className="text-red-600 font-bold">{i.monthsLeft <= 0 ? 'EXPIRED' : `${i.monthsLeft}m left`} · deadline {i.deadline}</span>
                <span className="font-mono font-black">{rs(i.vat)}</span>
                <button disabled={busy} onClick={() => moveCredits([i], period)} className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800">claim in {period} →</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Input credits claimed this period (the workbench) ── */}
      <div className="bg-white rounded-xl border border-slate-200 mb-4">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-bold text-sm text-slate-800">Input credits claimed in {period}</h3>
            <p className="text-[11px] text-slate-400">Tick any you want to keep for a later month — the payable figure above updates as you tick.</p>
          </div>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-amber-700">{selected.size} selected · {rs(selectedVat)}</span>
              <input type="month" value={moveTo} min={period} onChange={e => setMoveTo(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border-2 border-amber-300 text-xs font-bold outline-none" />
              <button disabled={busy} onClick={() => moveCredits(claimedNow.filter(i => selected.has(key(i))), moveTo)}
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-black disabled:opacity-50">
                Move to {moveTo}
              </button>
            </div>
          )}
        </div>
        {claimedNow.length === 0
          ? <div className="p-6 text-center text-sm text-slate-400">No input credits in this period</div>
          : claimedNow.map(i => row(i, true))}
      </div>

      {/* ── Parked for later ── */}
      {parkedLater.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-4">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-800">Waiting for later months · {rs(t.parkedTotal)}</h3>
            <p className="text-[11px] text-slate-400">Claim any of these back into {period} if you have output VAT to absorb them.</p>
          </div>
          {parkedLater.map(i => (
            <div key={key(i)} className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-xs">
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${i.kind === 'import' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                {i.kind === 'import' ? 'IMPORT' : 'LOCAL'}
              </span>
              <span className="font-mono font-bold">{i.ref}</span>
              <span className="flex-1 truncate text-slate-500">{i.partyName} · claim in {i.claimPeriod}</span>
              <span className={`text-[10px] font-bold ${i.monthsLeft <= 3 ? 'text-red-600' : 'text-slate-400'}`}>{i.monthsLeft}m left</span>
              <span className="font-mono font-black w-24 text-right">{rs(i.vat)}</span>
              <button disabled={busy} onClick={() => moveCredits([i], period)} className="text-[11px] font-bold text-emerald-700">claim now</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Schedule files ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <h3 className="font-bold text-sm text-slate-800 mb-1">📤 Schedules for the return</h3>
        {(() => {
          const gaps = claimedNow.filter(i => i.kind === 'local' && i.missingInvoiceInfo)
          if (gaps.length === 0) return null
          return (
            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
              ⚠️ {gaps.length} local purchase{gaps.length !== 1 ? 's' : ''} missing the supplier&apos;s invoice number or date
              ({gaps.slice(0, 4).map(g => g.ref).join(', ')}{gaps.length > 4 ? '…' : ''}) — Schedule 02 needs both. Fix them on the GRN before filing.
            </p>
          )
        })()}
        <p className="text-[11px] text-slate-400 mb-3">
          CSV in IRD&apos;s column order. Description is filled as &ldquo;{DESCRIPTION}&rdquo;; the filename has no period code yet —
          your accountant adds that at upload.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {[
            { n: '01', l: 'Output — sales', c: (data?.schedule01 || []).length, fn: genSchedule01 },
            { n: '02', l: 'Input — local', c: claimedNow.filter(i => i.kind === 'local').length, fn: genSchedule02 },
            { n: '03', l: 'Input — imports', c: claimedNow.filter(i => i.kind === 'import').length, fn: genSchedule03 },
            { n: '04', l: 'Credit notes', c: (data?.schedule04 || []).length, fn: genSchedule04 },
          ].map(s => (
            <button key={s.n} onClick={s.fn} disabled={s.c === 0}
              className="text-left px-3.5 py-3 rounded-xl border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white transition">
              <p className="text-xs font-black text-slate-800">Schedule {s.n}</p>
              <p className="text-[11px] text-slate-500">{s.l}</p>
              <p className="text-[11px] font-bold text-emerald-700 mt-1">{s.c} row{s.c !== 1 ? 's' : ''} ⬇</p>
            </button>
          ))}
        </div>

        {onOpenRegisters && (
          <button onClick={onOpenRegisters} className="mt-3 text-xs font-bold text-slate-500 hover:text-orange-600">
            Registers &amp; printable reports (VAT register, input VAT, SSCL quarterly) →
          </button>
        )}
      </div>
    </div>
  )
}
