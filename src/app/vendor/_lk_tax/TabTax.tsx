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
import TaxRegisters from './TaxRegisters'

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

// Where an input credit came from: stock bought locally, an overhead or
// consumable paid as an expense, or VAT paid at Customs on a shipment.
const KIND_LABEL: Record<string, string> = { local: 'STOCK', expense: 'OVERHEAD', import: 'IMPORT' }
const KIND_STYLE: Record<string, string> = {
  local: 'bg-slate-100 text-slate-600',
  expense: 'bg-violet-100 text-violet-700',
  import: 'bg-sky-100 text-sky-700',
}

// What goes in the schedules' free-text Description column. Owner's accountant
// will confirm the wording; "Auto parts" is the working default.
const DESCRIPTION = 'Auto parts'

export default function TabTax({ showToast, vendorSettings }: {
  showToast: (m: string) => void
  vendorSettings?: any
}) {
  // Two halves of the same job: close the period (Filing) and evidence it
  // (Registers — VAT output/input registers, VAT summary, SSCL liability).
  const [section, setSection] = useState<'filing' | 'registers'>('filing')
  const [period, setPeriod] = useState(colomboToday().slice(0, 7))
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/vat-filing?period=${p}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setData(j)
      setSelected(new Set())
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

  // Oldest first: the credit closest to its deadline is the one to look at.
  const claimedNow: any[] = [...(data?.input?.claimedNow || [])]
    .sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)))
  const nextMonth = addMonths(period, 1)
  // Same rule for the waiting list — closest to its deadline at the top
  const parkedLater: any[] = [...(data?.input?.parkedLater || [])]
    .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
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

  const localAndExpense = claimedNow.filter(i => i.kind === 'local' || i.kind === 'expense')
  const genSchedule02 = () => download('02',
    "Serial No,Invoice Date,Tax Invoice No,Supplier's TIN,Name of the Supplier,Description,Value of purchase,VAT Amount,Disallowed VAT Amount",
    localAndExpense.map((r: any, i: number) =>
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

  const sectionTabs = (
    <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1 w-fit">
      {([{ v: 'filing', l: '🗂️ Filing' }, { v: 'registers', l: '📚 Registers & Reports' }] as const).map(t => (
        <button key={t.v} onClick={() => setSection(t.v)}
          className={`px-4 py-2 text-xs font-bold rounded-md transition ${section === t.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {t.l}
        </button>
      ))}
    </div>
  )

  if (section === 'registers') {
    return (
      <div>
        <div className="mb-4">
          <h1 className="text-2xl font-black text-slate-900">🗂️ Tax</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Whole company — parts shop and workshop together, one TIN {vendorSettings?.tax_id ? `(${vendorSettings.tax_id})` : ''}
          </p>
        </div>
        {sectionTabs}
        <TaxRegisters showToast={showToast} vendorSettings={vendorSettings} onGoToFiling={() => setSection('filing')} />
      </div>
    )
  }

  if (loading) return (
    <div>
      {sectionTabs}
      <div className="p-8 text-center text-slate-400 text-sm">Loading period…</div>
    </div>
  )

  const row = (i: any, checkable: boolean) => (
    <div key={key(i)} className={`flex items-center gap-2 px-3 py-2 border-b border-slate-100 text-xs ${selected.has(key(i)) ? 'bg-amber-50' : ''}`}>
      {checkable && (
        <input type="checkbox" checked={selected.has(key(i))} onChange={() => toggle(i)} className="w-4 h-4 accent-amber-500 shrink-0" />
      )}
      <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${KIND_STYLE[i.kind] || 'bg-slate-100 text-slate-600'}`}>
        {KIND_LABEL[i.kind] || 'LOCAL'}
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

      {sectionTabs}

      <PeriodLockPanel period={period} showToast={showToast} />

      {/* ── The number that matters ── */}
      <div className={`rounded-xl border-2 p-5 mb-4 ${inRefundPosition ? 'border-red-300 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">VAT payable for {period}</p>
            <p className={`text-3xl font-black mt-1 ${inRefundPosition ? 'text-red-600' : 'text-emerald-700'}`}>{rs(t.netPayable)}</p>
            {inRefundPosition && (
              <p className="text-xs font-bold text-red-700 mt-1">
                Negative — you&apos;d be claiming a refund. Hold back {rs(Math.abs(t.netPayable))} of input credits below.
              </p>
            )}
            {selectedVat > 0 && (
              <p className="text-xs font-bold text-amber-700 mt-1">
                Holding back {rs(selectedVat)} → payable becomes <span className="font-black">{rs(projectedPayable)}</span>
              </p>
            )}
          </div>
          <div className="text-right text-xs text-slate-600 space-y-0.5">
            <p>Output VAT: <span className="font-mono font-bold">{rs(t.outputVat)}</span> <span className="text-slate-400">({t.invoiceCount} invoices)</span></p>
            {t.crnVat > 0 && <p>Less credit notes: <span className="font-mono font-bold text-red-600">−{rs(t.crnVat)}</span></p>}
            <p>Input VAT claimed: <span className="font-mono font-bold">−{rs(t.inputVat)}</span></p>
            <p className="text-[11px] text-slate-400">stock {rs(t.inputLocal)} · overheads {rs(t.inputExpense)} · imports {rs(t.inputImport)}</p>
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
            <p className="text-[11px] text-slate-400">
              Tick any you want to hold back — they move to {nextMonth}, and you decide again there. The payable figure above updates as you tick.
            </p>
          </div>
          {selected.size > 0 && (() => {
            const picked = claimedNow.filter(i => selected.has(key(i)))
            // Anything whose deadline is this month cannot wait another one
            const stuck = picked.filter(i => i.deadline <= period)
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-700">{selected.size} selected · {rs(selectedVat)}</span>
                <button disabled={busy || stuck.length > 0} onClick={() => moveCredits(picked, nextMonth)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-black disabled:opacity-50">
                  Keep for {nextMonth} →
                </button>
                {stuck.length > 0 && (
                  <span className="text-[11px] font-bold text-red-600">
                    {stuck.map(i => i.ref).join(', ')} must be claimed this month — last month before the deadline
                  </span>
                )}
              </div>
            )
          })()}
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
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${KIND_STYLE[i.kind] || 'bg-slate-100 text-slate-600'}`}>
                {KIND_LABEL[i.kind] || 'LOCAL'}
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
          const gaps = localAndExpense.filter(i => i.missingInvoiceInfo)
          if (gaps.length === 0) return null
          return (
            <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
              ⚠️ {gaps.length} local purchase{gaps.length !== 1 ? 's' : ''} missing the supplier&apos;s invoice details
              ({gaps.slice(0, 4).map(g => g.ref).join(', ')}{gaps.length > 4 ? '…' : ''}) — Schedule 02 needs the invoice number, date and supplier TIN. Fix them before filing.
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
            { n: '02', l: 'Input — local & overheads', c: localAndExpense.length, fn: genSchedule02 },
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

        <button onClick={() => setSection('registers')} className="mt-3 text-xs font-bold text-slate-500 hover:text-orange-600">
          Registers &amp; printable reports (VAT register, input VAT, SSCL liability) →
        </button>
      </div>
    </div>
  )
}

// ── Period locks + dated rates (owner-only; hides itself for staff) ──────────
// Lock the month after filing its return: from then on no credit note,
// bad-debt write-off or recovery can land in it — corrections become documents
// of the CURRENT period, so the filed return and the register never diverge.
function PeriodLockPanel({ period, showToast }: { period: string; showToast: (m: string) => void }) {
  const [locks, setLocks] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRates, setShowRates] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [rate, setRate] = useState({ key: 'vat_rate', value: '', effectiveFrom: '' })

  const loadLocks = useCallback(async () => {
    try {
      const r = await fetch('/api/vendor/period-locks')
      if (r.status === 403) { setLocks(null); return } // staff — hide the panel
      const j = await r.json()
      setLocks((j.locks || []).map((l: any) => l.period))
    } catch { setLocks(null) }
  }, [])
  useEffect(() => { loadLocks() }, [loadLocks])

  async function toggleLock(locked: boolean) {
    if (!locked && !confirm(`Lock ${period}?\n\nDo this AFTER filing its VAT return. No credit note, write-off or recovery can then be dated into it.`)) return
    if (locked && !confirm(`Unlock ${period}? Only for corrections — re-lock afterwards.`)) return
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/period-locks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: locked ? 'unlock' : 'lock', period }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast('✅ ' + j.message)
      await loadLocks()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  async function loadHistory() {
    const r = await fetch('/api/vendor/tax-config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rate_history' }),
    })
    const j = await r.json()
    setHistory(j.history || [])
  }

  async function scheduleRate() {
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/tax-config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedule_rate', key: rate.key, value: rate.value, effectiveFrom: rate.effectiveFrom }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast('✅ ' + j.message)
      setRate({ key: 'vat_rate', value: '', effectiveFrom: '' })
      await loadHistory()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(false)
  }

  if (locks === null) return null
  const isLocked = locks.includes(period)
  const KEY_LABEL: Record<string, string> = {
    vat_rate: 'VAT %', sscl_rate: 'SSCL %', liable_base_part: 'SSCL base — parts %', liable_base_svc: 'SSCL base — services %',
  }

  return (
    <div className={`rounded-xl border-2 p-4 mb-4 ${isLocked ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-xs font-black text-slate-700">
            {isLocked ? `🔒 ${period} is LOCKED` : `🔓 ${period} is open`}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isLocked
              ? 'Return filed — no credit notes, write-offs or recoveries can be dated into it.'
              : 'After filing this month\'s return, lock it so the filed figures can never drift.'}
            {locks.length > 0 && ` Locked: ${locks.sort().join(', ')}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => toggleLock(isLocked)} disabled={busy}
            className={`text-xs font-bold px-3.5 py-2 rounded-lg ${isLocked ? 'border-2 border-slate-300 text-slate-600' : 'bg-slate-800 text-white'}`}>
            {isLocked ? 'Unlock' : `Lock ${period}`}
          </button>
          <button onClick={() => { setShowRates(v => !v); if (!showRates) loadHistory() }}
            className="text-xs font-bold px-3.5 py-2 rounded-lg border-2 border-slate-200 text-slate-500">
            Rates {showRates ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {showRates && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[11px] text-slate-400 mb-2">
            Rate changes take effect on their date — invoices switch automatically, and every report uses the rate in force for the month it covers. Old quarters never move.
          </p>
          <div className="flex gap-2 flex-wrap items-end mb-2">
            <select value={rate.key} onChange={e => setRate(p => ({ ...p, key: e.target.value }))}
              className="px-2.5 py-2 rounded-lg border-2 border-slate-200 text-xs bg-white outline-none">
              {Object.entries(KEY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input type="number" step="0.1" value={rate.value} onChange={e => setRate(p => ({ ...p, value: e.target.value }))}
              placeholder="New %" className="w-24 px-2.5 py-2 rounded-lg border-2 border-slate-200 text-xs font-mono font-bold outline-none" />
            <input type="date" value={rate.effectiveFrom} onChange={e => setRate(p => ({ ...p, effectiveFrom: e.target.value }))}
              className="px-2.5 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" />
            <button onClick={scheduleRate} disabled={busy || !rate.value || !rate.effectiveFrom}
              className="text-xs font-bold px-3.5 py-2 rounded-lg bg-orange-500 text-white disabled:opacity-40">Schedule</button>
          </div>
          {history.length > 0 && (
            <div className="text-[11px] text-slate-500 space-y-0.5">
              {history.map((h: any, i: number) => (
                <div key={i} className="flex gap-2">
                  <span className="font-mono">{h.effective_from}</span>
                  <span className="font-bold">{KEY_LABEL[h.key] || h.key}</span>
                  <span className="font-mono font-bold">{h.value}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
