'use client'
// ── WHEEL MART ONLY — Insurance claims (stage 1: the claim spine) ────────────
//
// One claim = everything one accident sends to one insurer:
//   · our PART invoice and the workshop's REPR invoice (sales rows)
//   · outside vendors' pass-through bills (never our revenue, VAT or SSCL)
//
// This screen answers the question nobody could answer before: "for claim
// AB-1234, what did we submit, what has come in, and what is still out?"
// Stage 2 adds discharge-voucher settlement and shortfall classification.

import { useState, useEffect, useCallback } from 'react'

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-sky-100 text-sky-700',
  settling: 'bg-amber-100 text-amber-700',
  closed: 'bg-slate-200 text-slate-600',
}

export default function TabClaims({ showToast }: { showToast: (m: string) => void }) {
  const [claims, setClaims] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // New claim form
  const [showNew, setShowNew] = useState(false)
  const [insurers, setInsurers] = useState<any[]>([])
  const [newClaim, setNewClaim] = useState({ insurerCustomerId: '', claimNo: '', vehicleNo: '', jobRef: '', notes: '' })

  // Bill form (per open claim)
  const [showBill, setShowBill] = useState(false)
  const [bill, setBill] = useState({ supplierName: '', billRef: '', billAmount: '', paidAmount: '', fronted: true, note: '' })

  // Link-invoice form
  const [linkNo, setLinkNo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (statusFilter) params.set('status', statusFilter)
      const r = await fetch('/api/vendor/claims?' + params.toString())
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setClaims(j.claims || [])
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setLoading(false)
  }, [q, statusFilter, showToast])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/vendor/customers').then(r => r.json()).then(j => {
      setInsurers((j.customers || []).filter((c: any) => c.is_insurance))
    }).catch(() => {})
  }, [])

  async function post(body: any, okMsg: string): Promise<boolean> {
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast(okMsg)
      await load()
      return true
    } catch (e: any) { showToast('⚠️ ' + e.message); return false }
    finally { setBusy(false) }
  }

  async function createClaim() {
    const ok = await post({ action: 'create', ...newClaim }, '✅ Claim recorded')
    if (ok) { setShowNew(false); setNewClaim({ insurerCustomerId: '', claimNo: '', vehicleNo: '', jobRef: '', notes: '' }) }
  }

  async function addBill(claimId: string) {
    const ok = await post({ action: 'add_bill', claimId, ...bill }, '✅ Vendor bill recorded on the claim')
    if (ok) { setShowBill(false); setBill({ supplierName: '', billRef: '', billAmount: '', paidAmount: '', fronted: true, note: '' }) }
  }

  const openClaim = claims.find(c => c.id === openId) || null

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <h2 className="text-lg font-black text-slate-800">🛡️ Insurance Claims</h2>
          <p className="text-xs text-slate-400">Every document of one accident under one claim number — ours and the outside vendors&apos;.</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold">
          + New Claim
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search claim no or vehicle…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        {['', 'open', 'settling', 'closed'].map(st => (
          <button key={st || 'all'} onClick={() => setStatusFilter(st)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border-2 ${statusFilter === st ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'}`}>
            {st === '' ? 'All' : st === 'open' ? 'Open' : st === 'settling' ? 'Settling' : 'Closed'}
          </button>
        ))}
      </div>

      {/* New claim modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowNew(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900 mb-1">New insurance claim</h3>
            <p className="text-xs text-slate-400 mb-4">Usually the claim is created automatically when the first invoice carries its number — this form is for starting one ahead of billing.</p>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Insurance company *</label>
            <select value={newClaim.insurerCustomerId} onChange={e => setNewClaim(p => ({ ...p, insurerCustomerId: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none bg-white mb-3">
              <option value="">Choose…</option>
              {insurers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Claim number <span className="font-normal text-slate-400">(leave blank if not known yet)</span></label>
            <input value={newClaim.claimNo} onChange={e => setNewClaim(p => ({ ...p, claimNo: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none focus:border-orange-400 mb-3" />
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">Vehicle</label>
                <input value={newClaim.vehicleNo} onChange={e => setNewClaim(p => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none" placeholder="ABC-1234" />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">Workshop job</label>
                <input value={newClaim.jobRef} onChange={e => setNewClaim(p => ({ ...p, jobRef: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="JOB-2026-…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500">Cancel</button>
              <button onClick={createClaim} disabled={busy || !newClaim.insurerCustomerId || (!newClaim.claimNo.trim() && !newClaim.vehicleNo.trim())}
                className="px-5 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold disabled:opacity-40">
                {busy ? 'Saving…' : 'Create claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-10 text-center text-slate-400 text-sm">Loading claims…</div>
      ) : claims.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <div className="text-3xl mb-2">🛡️</div>
          <p className="text-sm font-semibold text-slate-500">No claims yet</p>
          <p className="text-xs text-slate-400 mt-1">Bill an insurance customer at the POS and the claim appears here on its own — keyed by vehicle, the claim number added later when the insurer's papers arrive.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {claims.map(c => {
            const isOpen = openId === c.id
            return (
              <div key={c.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => { setOpenId(isOpen ? null : c.id); setShowBill(false); setLinkNo('') }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.claim_no
                        ? <span className="font-mono font-black text-slate-800">{c.claim_no}</span>
                        : <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">NO CLAIM № YET</span>}
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${STATUS_BADGE[c.status]}`}>{c.status.toUpperCase()}</span>
                      {c.vehicle_no && <span className="text-xs font-mono font-bold text-slate-500">{c.vehicle_no}</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 truncate">{c.insurer?.name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-400">claimed / received</div>
                    <div className="text-sm font-black text-slate-800">{rs(c.totals.claimedTotal)}
                      <span className={`ml-1 ${c.totals.outstandingTotal > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>/ {rs(c.totals.receivedTotal)}</span>
                    </div>
                  </div>
                  <span className="text-slate-300">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div className="px-4 pb-4 bg-slate-50/60 border-t border-slate-100">
                    {/* Claim number — usually attached AFTER billing, when the
                        insurer's paperwork (which always carries it) arrives */}
                    <div className="flex items-center gap-2 mt-3 mb-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide shrink-0">Claim №</span>
                      <ClaimNoEditor claim={c} onSave={(v: string) => post({ action: 'update', claimId: c.id, claimNo: v }, v ? '✅ Claim number saved' : 'Claim number cleared')} />
                    </div>

                    {/* Our invoices */}
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mt-3 mb-1.5">Our invoices</p>
                    {c.sales.length === 0 ? (
                      <p className="text-xs text-slate-400 mb-2">None linked yet.</p>
                    ) : c.sales.map((s: any) => (
                      <div key={s.id} className={`flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2 mb-1.5 ${s.payment_status === 'voided' ? 'opacity-50' : ''}`}>
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">{s.entity?.serial_qqqq || '—'}</span>
                        <span className="flex-1 font-mono text-xs font-bold text-slate-700 truncate">{s.tax_serial || s.receipt_no || s.invoice_no}</span>
                        {s.payment_status === 'voided'
                          ? <span className="text-[10px] font-black text-red-500">VOID</span>
                          : <>
                              <span className="text-xs font-bold text-slate-800">{rs(s.total)}</span>
                              <span className={`text-[10px] font-bold ${Number(s.balance_due) > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {Number(s.balance_due) > 0 ? rs(s.balance_due) + ' due' : 'paid'}
                              </span>
                            </>}
                      </div>
                    ))}
                    <div className="flex gap-2 mb-3">
                      <input value={linkNo} onChange={e => setLinkNo(e.target.value)} placeholder="Link an invoice by number/serial…"
                        className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono outline-none focus:border-orange-400" />
                      <button onClick={async () => { const ok = await post({ action: 'link_sale', claimId: c.id, invoiceNo: linkNo.trim() }, '✅ Invoice linked'); if (ok) setLinkNo('') }}
                        disabled={busy || !linkNo.trim()}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold disabled:opacity-40">Link</button>
                    </div>

                    {/* Outside vendors' bills */}
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mb-1.5">Outside vendors&apos; bills <span className="normal-case font-semibold">(pass-through — never our VAT)</span></p>
                    {c.bills.map((b: any) => (
                      <div key={b.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-3 py-2 mb-1.5">
                        <span className="flex-1 text-xs font-semibold text-slate-700 truncate">
                          {b.supplier_name}{b.bill_ref && <span className="text-slate-400 font-mono"> · {b.bill_ref}</span>}
                          {!b.fronted && <span className="text-[9px] font-black text-sky-600 ml-1">INSURER PAYS DIRECT</span>}
                        </span>
                        <span className="text-xs font-bold text-slate-800">{rs(b.bill_amount)}</span>
                        {b.fronted && b.paid_amount != null && b.paid_amount !== b.bill_amount && (
                          <span className="text-[10px] font-bold text-emerald-600">paid {rs(b.paid_amount)}</span>
                        )}
                        <button onClick={() => { if (confirm(`Remove ${b.supplier_name}'s bill from the claim?`)) post({ action: 'delete_bill', billId: b.id }, 'Bill removed') }}
                          className="text-red-300 hover:text-red-500 font-bold text-sm leading-none">×</button>
                      </div>
                    ))}
                    {showBill ? (
                      <div className="bg-white rounded-lg border-2 border-amber-200 p-3 mb-3">
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input value={bill.supplierName} onChange={e => setBill(p => ({ ...p, supplierName: e.target.value }))}
                            placeholder="Vendor name *" className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none" />
                          <input value={bill.billRef} onChange={e => setBill(p => ({ ...p, billRef: e.target.value }))}
                            placeholder="Bill no." className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono outline-none" />
                          <input type="number" value={bill.billAmount} onChange={e => setBill(p => ({ ...p, billAmount: e.target.value }))}
                            placeholder="Bill amount (to insurer) *" className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono outline-none" />
                          <input type="number" value={bill.paidAmount} onChange={e => setBill(p => ({ ...p, paidAmount: e.target.value }))}
                            disabled={!bill.fronted}
                            placeholder={bill.fronted ? 'We actually paid (blank = same)' : '—'}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono outline-none disabled:bg-slate-50" />
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-600 mb-2 cursor-pointer">
                          <input type="checkbox" checked={bill.fronted} onChange={e => setBill(p => ({ ...p, fronted: e.target.checked }))} className="w-4 h-4 accent-amber-500" />
                          We paid this vendor (insurer reimburses us)
                        </label>
                        {bill.fronted && bill.paidAmount !== '' && Number(bill.paidAmount) < Number(bill.billAmount || 0) && (
                          <p className="text-[10px] font-bold text-emerald-700 mb-2">
                            Vendor discount: {rs(Number(bill.billAmount) - Number(bill.paidAmount))} stays as job profit when the insurer reimburses the full bill.
                          </p>
                        )}
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setShowBill(false)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500">Cancel</button>
                          <button onClick={() => addBill(c.id)} disabled={busy || !bill.supplierName.trim() || !bill.billAmount}
                            className="px-4 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold disabled:opacity-40">Add bill</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setShowBill(true)}
                        className="text-xs font-bold text-amber-700 border-2 border-dashed border-amber-300 rounded-lg px-3 py-1.5 mb-3 hover:bg-amber-50">
                        + Outside vendor&apos;s bill
                      </button>
                    )}

                    {/* Totals */}
                    <div className="bg-white rounded-lg border border-slate-200 px-3 py-2.5 text-xs">
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Submitted to insurer</span><span className="font-bold">{rs(c.totals.claimedTotal)}</span></div>
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Received so far</span><span className="font-bold text-emerald-700">{rs(c.totals.receivedTotal)}</span></div>
                      <div className="flex justify-between py-0.5 border-t border-slate-100 mt-1 pt-1.5">
                        <span className="font-bold text-slate-700">Still outstanding</span>
                        <span className={`font-black ${c.totals.outstandingTotal > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{rs(c.totals.outstandingTotal)}</span>
                      </div>
                    </div>

                    {/* Status */}
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                      {['open', 'settling', 'closed'].map(st => (
                        <button key={st} onClick={() => c.status !== st && post({ action: 'update', claimId: c.id, status: st }, `Claim marked ${st}`)}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-black ${c.status === st ? STATUS_BADGE[st] : 'bg-white border border-slate-200 text-slate-400'}`}>
                          {st.toUpperCase()}
                        </button>
                      ))}
                      {c.workshop_job_ref && <span className="ml-auto text-[10px] text-slate-400">🔧 {c.workshop_job_ref}</span>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Inline claim-number editor — the number usually arrives with the insurer's
// paperwork long after billing, so it is set here, not at the POS.
function ClaimNoEditor({ claim, onSave }: { claim: any; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(claim.claim_no || '')
  useEffect(() => { setV(claim.claim_no || '') }, [claim.claim_no])
  if (!editing) {
    return (
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-mono text-xs font-bold text-slate-700 truncate">{claim.claim_no || '— not known yet —'}</span>
        <button onClick={() => setEditing(true)} className="text-[10px] font-bold text-sky-600">edit</button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 flex-1">
      <input value={v} onChange={e => setV(e.target.value)} autoFocus
        placeholder="e.g. MTR/2026/48291"
        className="flex-1 min-w-0 px-2 py-1 rounded-lg border-2 border-sky-300 text-xs font-mono font-bold outline-none focus:border-sky-400" />
      <button onClick={() => { setEditing(false); onSave(v.trim()) }} className="text-[10px] font-black text-emerald-600">SAVE</button>
      <button onClick={() => { setEditing(false); setV(claim.claim_no || '') }} className="text-[10px] font-bold text-slate-400">✕</button>
    </span>
  )
}
