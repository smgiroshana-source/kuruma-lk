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

export default function TabClaims({ showToast, staffRole }: { showToast: (m: string) => void; staffRole?: string }) {
  const mayApprove = staffRole === 'owner' || staffRole === 'manager'
  const isOwner = staffRole === 'owner'
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

  // Settlement modal — settleFor holds the claim being settled
  const [settleFor, setSettleFor] = useState<any>(null)

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

  async function postSettle(body: any): Promise<{ ok: boolean; message?: string }> {
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/claim-settlements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast('✅ ' + (j.message || 'Done'))
      await load()
      return { ok: true, message: j.message }
    } catch (e: any) { showToast('⚠️ ' + e.message); return { ok: false } }
    finally { setBusy(false) }
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

      {settleFor && (
        <SettlementModal claim={claims.find(x => x.id === settleFor.id) || settleFor}
          busy={busy} onClose={() => setSettleFor(null)}
          onSave={async (payload: any) => {
            const r = await postSettle({ action: 'record_settlement', claimId: settleFor.id, ...payload })
            if (r.ok) setSettleFor(null)
          }} />
      )}

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

                    {/* Settlements — the insurer's money, entered off the voucher */}
                    <div className="flex items-center justify-between mt-3 mb-1.5">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide">Settlements received</p>
                      <button onClick={() => setSettleFor(c)}
                        className="text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5">
                        + Record settlement
                      </button>
                    </div>
                    {(c.settlements || []).length === 0 ? (
                      <p className="text-xs text-slate-400 mb-2">Nothing received yet.</p>
                    ) : (c.settlements || []).map((st: any) => (
                      <div key={st.id} className="flex items-center gap-2 bg-white rounded-lg border border-emerald-200 px-3 py-2 mb-1.5 text-xs">
                        <span className="font-mono text-slate-500">{st.received_date}</span>
                        <span className="flex-1 text-slate-700 truncate">{st.voucher_ref || 'Settlement'} · {st.payment_method}{st.vat_inclusive ? '' : ' · figures were ex-VAT'}</span>
                        <span className="font-black text-emerald-700">{rs(st.gross_amount)}</span>
                      </div>
                    ))}

                    {/* Shortfalls — every rupee short must be classified */}
                    {(c.shortfalls || []).length > 0 && (
                      <>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wide mt-3 mb-1.5">
                          Shortfalls
                          {(c.shortfalls || []).some((x: any) => !x.classification) && (
                            <span className="ml-2 text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 normal-case">UNCLASSIFIED — claim cannot close</span>
                          )}
                        </p>
                        {(c.shortfalls || []).map((sf: any) => (
                          <ShortfallRow key={sf.id} sf={sf} claim={c}
                            mayApprove={mayApprove} isOwner={isOwner} busy={busy}
                            onAction={postSettle} />
                        ))}
                      </>
                    )}

                    {/* Status */}
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                      {['open', 'settling', 'closed'].map(st => (
                        <button key={st} onClick={() => {
                          if (c.status === st) return
                          if (st === 'closed' && (c.shortfalls || []).some((x: any) => !x.classification)) {
                            showToast('⚠️ Classify every shortfall before closing the claim'); return
                          }
                          post({ action: 'update', claimId: c.id, status: st }, `Claim marked ${st}`)
                        }}
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

const DISC_REASONS = [
  { v: 'goodwill', l: 'Goodwill / relationship' },
  { v: 'dispute_settlement', l: 'Dispute settled' },
  { v: 'pricing_error', l: 'Pricing error on our side' },
  { v: 'other', l: 'Other (explain below)' },
]

// One shortfall: what is short, what was decided, and the controls to decide.
function ShortfallRow({ sf, claim, mayApprove, isOwner, busy, onAction }: any) {
  const [picking, setPicking] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('goodwill')
  const [reasonText, setReasonText] = useState('')
  const [reinvNo, setReinvNo] = useState('')

  const sale = sf.sale_id ? (claim.sales || []).find((x: any) => x.id === sf.sale_id) : null
  const bill = sf.bill_id ? (claim.bills || []).find((x: any) => x.id === sf.bill_id) : null
  const docLabel = sale ? (sale.tax_serial || sale.receipt_no || sale.invoice_no)
    : bill ? bill.supplier_name + (bill.bill_ref ? ' · ' + bill.bill_ref : '') : '—'

  const CLS_BADGE: Record<string, string> = {
    CR: 'bg-sky-100 text-sky-700', WD: 'bg-amber-100 text-amber-800',
    DISC: 'bg-purple-100 text-purple-700', DEBT: 'bg-slate-200 text-slate-600',
    RECOVER: 'bg-sky-100 text-sky-700', ABSORB: 'bg-slate-200 text-slate-600',
  }
  const CLS_HINT: Record<string, string> = {
    CR: 'Owner owes it — credit note + re-invoice, tax unchanged',
    WD: 'Accept less as full settlement — VAT & SSCL reduce',
    DISC: 'Deliberate waiver — VAT & SSCL reduce, reason needed',
    DEBT: 'Still chasing — stays receivable, VAT unchanged',
    RECOVER: 'Chase the vehicle owner for it (no tax documents)',
    ABSORB: 'Take it as a loss on the job (no tax documents)',
  }

  async function classify(cls: string) {
    if (cls === 'DISC' && picking !== 'DISC') { setPicking('DISC'); return }
    if ((cls === 'WD' || cls === 'DISC') && !confirm(
      cls === 'WD'
        ? `Write down ${docLabel} by Rs.${Number(sf.amount).toLocaleString()}?\n\nA credit note is issued, output VAT reduces, and NO further receipt can ever be recorded on this invoice.`
        : `Give a discount of Rs.${Number(sf.amount).toLocaleString()} on ${docLabel}?\n\nSame tax effect as a write-down: credit note, VAT reduces, receipts blocked.`)) return
    const r = await onAction({ action: 'classify', shortfallId: sf.id, classification: cls, reasonCode: cls === 'DISC' ? reasonCode : null, reasonText: reasonText.trim() || null })
    if (r.ok) setPicking(null)
  }

  return (
    <div className="bg-white rounded-lg border border-red-100 px-3 py-2 mb-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 text-xs font-semibold text-slate-700 truncate">
          {bill && <span className="text-[9px] font-black text-slate-400 mr-1">BILL</span>}{docLabel}
        </span>
        <span className="text-xs font-black text-red-600">{rs(sf.amount)} short</span>
        {sf.classification && (
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${CLS_BADGE[sf.classification]}`}>{sf.classification}</span>
        )}
        {sf.status === 'written_off' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">WRITTEN OFF</span>}
        {sf.status === 'recovered' && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">RECOVERED</span>}
      </div>

      {!sf.classification && (
        <div className="mt-2">
          <div className="flex gap-1.5 flex-wrap">
            {(bill ? ['RECOVER', 'ABSORB'] : ['CR', 'WD', 'DISC', 'DEBT']).map(cls => {
              const needsApproval = cls === 'WD' || cls === 'DISC'
              const disabled = busy || (needsApproval && !mayApprove)
              return (
                <button key={cls} onClick={() => classify(cls)} disabled={disabled}
                  title={CLS_HINT[cls] + (needsApproval && !mayApprove ? ' — owner/manager only' : '')}
                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border-2 ${disabled ? 'border-slate-100 text-slate-300' : picking === cls ? 'border-purple-400 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                  {cls}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">{picking ? CLS_HINT[picking] : bill ? 'Pass-through bill: recover from owner, or absorb.' : 'CR recoverable · WD write-down · DISC discount · DEBT keep chasing'}</p>
          {picking === 'DISC' && (
            <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
              <select value={reasonCode} onChange={e => setReasonCode(e.target.value)}
                className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white outline-none">
                {DISC_REASONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
              <input value={reasonText} onChange={e => setReasonText(e.target.value)} placeholder="Details (optional)"
                className="flex-1 min-w-[120px] px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] outline-none" />
              <button onClick={() => classify('DISC')} disabled={busy}
                className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-black">CONFIRM DISC</button>
            </div>
          )}
        </div>
      )}

      {sf.classification === 'CR' && sf.status === 'actioned' && !sf.reinvoice_sale_id && (
        <div className="flex gap-1.5 mt-2 items-center">
          <span className="text-[10px] font-bold text-sky-700 shrink-0">Re-invoice the owner, then attach:</span>
          <input value={reinvNo} onChange={e => setReinvNo(e.target.value)} placeholder="Invoice no / serial"
            className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-sky-200 text-[11px] font-mono outline-none" />
          <button onClick={async () => { const r = await onAction({ action: 'attach_reinvoice', shortfallId: sf.id, invoiceNo: reinvNo.trim() }); if (r.ok) setReinvNo('') }}
            disabled={busy || !reinvNo.trim()}
            className="px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[10px] font-black disabled:opacity-40">ATTACH</button>
        </div>
      )}

      {sf.classification === 'DEBT' && sf.status === 'actioned' && isOwner && (
        <button onClick={() => { if (confirm(`Write off Rs.${Number(sf.amount).toLocaleString()} as bad debt?\n\nVAT relief and SSCL exclusion apply to THIS period, and reverse if recovered later.`)) onAction({ action: 'write_off', shortfallId: sf.id }) }}
          disabled={busy}
          className="mt-2 text-[10px] font-black text-red-600 border-2 border-red-200 rounded-lg px-2.5 py-1 hover:bg-red-50">
          WRITE OFF AS BAD DEBT (owner)
        </button>
      )}
      {sf.status === 'written_off' && isOwner && (
        <button onClick={() => { if (confirm('Money recovered on this written-off debt? The VAT relief reverses this period.')) onAction({ action: 'record_recovery', shortfallId: sf.id }) }}
          disabled={busy}
          className="mt-2 text-[10px] font-black text-emerald-700 border-2 border-emerald-200 rounded-lg px-2.5 py-1 hover:bg-emerald-50">
          MARK RECOVERED (owner)
        </button>
      )}
    </div>
  )
}

// The discharge voucher, entered once: date, reference, an EXPLICIT VAT
// incl/excl choice (no default — never inferred), and the split across the
// claim's open documents with a pro-rata fill for lump figures.
function SettlementModal({ claim, busy, onClose, onSave }: any) {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }))
  const [voucherRef, setVoucherRef] = useState('')
  const [method, setMethod] = useState('bank')
  const [bankRef, setBankRef] = useState('')
  const [vatMode, setVatMode] = useState<null | boolean>(null)
  const [lumpTotal, setLumpTotal] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [methods, setMethods] = useState<Record<string, string>>({})

  const openSales = (claim.sales || []).filter((x: any) => x.payment_status !== 'voided' && Number(x.balance_due) > 0)
  const openBills = (claim.bills || []).filter((b: any) => Number(b.bill_amount) - Number(b.reimbursed_amount) > 0)
  const targets = [
    ...openSales.map((x: any) => ({ key: 'sale:' + x.id, kind: 'sale', id: x.id, label: x.tax_serial || x.receipt_no || x.invoice_no, room: Number(x.balance_due), entity: x.entity?.serial_qqqq })),
    ...openBills.map((b: any) => ({ key: 'bill:' + b.id, kind: 'bill', id: b.id, label: b.supplier_name + (b.bill_ref ? ' · ' + b.bill_ref : ''), room: Number(b.bill_amount) - Number(b.reimbursed_amount), entity: 'BILL' })),
  ]

  function prorata() {
    const total = Math.round(Number(lumpTotal) || 0)
    if (total <= 0) return
    const roomTotal = targets.reduce((t, x) => t + x.room, 0) || 1
    const next: Record<string, string> = {}
    const nextM: Record<string, string> = {}
    let used = 0
    targets.forEach((t, i) => {
      const share = i === targets.length - 1 ? Math.min(t.room, total - used) : Math.min(t.room, Math.round(total * t.room / roomTotal))
      used += share
      next[t.key] = share > 0 ? String(share) : ''
      nextM[t.key] = 'prorata'
    })
    setAmounts(next); setMethods(nextM)
  }

  const allocated = targets.reduce((t, x) => t + (Math.round(Number(amounts[x.key])) || 0), 0)

  function save() {
    if (vatMode === null) return
    const lines = targets
      .map(t => ({ t, amt: Math.round(Number(amounts[t.key]) || 0) }))
      .filter(x => x.amt > 0)
      .map(x => ({
        saleId: x.t.kind === 'sale' ? x.t.id : undefined,
        billId: x.t.kind === 'bill' ? x.t.id : undefined,
        amount: x.amt,
        allocationMethod: methods[x.t.key] || 'direct',
      }))
    onSave({ receivedDate: date, voucherRef: voucherRef.trim() || null, vatInclusive: vatMode, paymentMethod: method, bankRef: bankRef.trim() || null, lines })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto" onClick={(e: any) => e.stopPropagation()}>
        <h3 className="text-lg font-black text-slate-900 mb-1">Record settlement — {claim.claim_no || claim.vehicle_no}</h3>
        <p className="text-xs text-slate-400 mb-4">Enter the discharge voucher / payment once and split it across the claim&apos;s documents.</p>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Received date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Voucher / ref</label>
            <input value={voucherRef} onChange={e => setVoucherRef(e.target.value)} placeholder="DV no."
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm bg-white outline-none">
              <option value="bank">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-500 block mb-1">Bank / cheque ref</label>
            <input value={bankRef} onChange={e => setBankRef(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none" />
          </div>
        </div>

        {/* Explicit, no default — the whole point is that this is never assumed */}
        <label className="text-[11px] font-bold text-slate-500 block mb-1">The voucher&apos;s figures are… *</label>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setVatMode(true)}
            className={`px-3 py-2.5 rounded-lg border-2 text-xs font-bold ${vatMode === true ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
            VAT-INCLUSIVE<span className="block text-[9px] font-semibold opacity-70">figures match our invoice totals</span>
          </button>
          <button onClick={() => setVatMode(false)}
            className={`px-3 py-2.5 rounded-lg border-2 text-xs font-bold ${vatMode === false ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500'}`}>
            VAT-EXCLUSIVE<span className="block text-[9px] font-semibold opacity-70">we add each invoice&apos;s own VAT on top</span>
          </button>
        </div>

        <div className="flex gap-2 items-center mb-2">
          <input type="number" value={lumpTotal} onChange={e => setLumpTotal(e.target.value)} placeholder="Lump total received"
            className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono font-bold outline-none" />
          <button onClick={prorata} disabled={!Number(lumpTotal)}
            className="px-3 py-2 rounded-lg bg-slate-800 text-white text-xs font-bold disabled:opacity-40">Split pro-rata</button>
        </div>
        <p className="text-[10px] text-slate-400 mb-2">Pro-rata splits by each document&apos;s outstanding value — check the split below and adjust any line before saving.</p>

        {targets.map(t => (
          <div key={t.key} className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0 w-10 text-center">{t.entity || '—'}</span>
            <span className="flex-1 min-w-0 text-xs font-semibold text-slate-700 truncate">{t.label}</span>
            <span className="text-[10px] text-slate-400 shrink-0">of {rs(t.room)}</span>
            <input type="number" value={amounts[t.key] || ''} min={0}
              onChange={e => { setAmounts(p => ({ ...p, [t.key]: e.target.value })); setMethods(p => ({ ...p, [t.key]: 'manual' })) }}
              className="w-28 px-2 py-1.5 rounded-lg border-2 border-slate-200 text-xs font-mono font-bold text-right outline-none focus:border-emerald-400" />
          </div>
        ))}

        <div className="flex justify-between items-center border-t border-slate-100 mt-3 pt-2 text-xs">
          <span className="text-slate-500 font-semibold">Allocated{vatMode === false ? ' (ex-VAT, as typed)' : ''}</span>
          <span className="font-black text-slate-800">{rs(allocated)}</span>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500">Cancel</button>
          <button onClick={save} disabled={busy || vatMode === null || allocated <= 0}
            title={vatMode === null ? 'Choose VAT-inclusive or VAT-exclusive first' : ''}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
            {busy ? 'Saving…' : 'Save settlement'}
          </button>
        </div>
      </div>
    </div>
  )
}
