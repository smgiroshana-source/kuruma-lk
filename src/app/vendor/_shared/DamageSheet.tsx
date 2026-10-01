'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// A product's damage, from the stock count (phone-first).
//
// Owner, 2026-10-01 (WHEEL MART first; Sakura the same day): a damaged item's card opens "Details" — the damage notes
// and photos on record — and more can be added from three sources: the
// camera, the phone's gallery, or this product's own photos (a photo already
// uploaded that shows the damage but was never marked). A damaged part can be
// marked Repaired: condition back, a dated REPAIRED line, and its damage
// photos retired from the storefront (kept here as "before repair").
// Server: /api/vendor/products damage_info / record_damage / set_damage_photos
// / mark_repaired, uploads with isDamage. Notes: src/lib/damage.ts.
// Phone rules: 16px text boxes (iPhone zooms on anything smaller), no
// autofocus, actions pinned clear of the home bar, big targets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compressImage } from '@/lib/compressImage'
import { damageNotes } from '@/lib/damage'

type Props = {
  product: any                 // { id, name, sku, description, condition }
  showToast: (msg: string) => void
  onClose: () => void
  onSaved: () => void          // parent refreshes its data
}

type Img = { id: string; url: string; is_damage: boolean; damage_resolved_at: string | null }
const CONDITIONS = ['Reconditioned', 'New', 'New-Genuine', 'New-Other']
const X = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
)

async function post(body: any) {
  const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (!j.success) throw new Error(j.error || 'Could not save')
  return j
}

export default function DamageSheet({ product, showToast, onClose, onSaved }: Props) {
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<any>(null)
  const [images, setImages] = useState<Img[]>([])
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [picked, setPicked] = useState<string[]>([])         // existing photos to mark as damage
  const [picking, setPicking] = useState(false)
  const [markDamaged, setMarkDamaged] = useState(true)
  const [repairing, setRepairing] = useState(false)
  const [repairCond, setRepairCond] = useState('')   // no default: a repair is a choice, not two taps
  const [repairNote, setRepairNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [viewer, setViewer] = useState<{ list: Img[]; i: number } | null>(null)
  const swipeX = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const j = await post({ action: 'damage_info', productId: product.id })
      setInfo(j.product); setImages(j.images || [])
      const hasDamage = (j.images || []).some((i: Img) => i.is_damage) || damageNotes(j.product.description).length > 0
      setAdding(!hasDamage)
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setLoading(false)
  }, [product.id, showToast])
  useEffect(() => { load() }, [load])

  // The page behind must not scroll while the sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])

  const notes = damageNotes(info?.description)
  const openDamage = images.filter(i => i.is_damage && !i.damage_resolved_at)
  const beforeRepair = images.filter(i => i.is_damage && i.damage_resolved_at)
  const ordinary = images.filter(i => !i.is_damage)
  const isDamaged = info?.condition === 'Damaged'
  const hasDamageNote = notes.some(n => n.kind === 'damage')
  const dirty = note.trim() !== '' || files.length > 0 || picked.length > 0

  function addFiles(list: FileList | null) {
    // Copy NOW: the FileList is live, and the input is cleared right after
    // this call — read inside the updater it was already empty, so camera and
    // gallery photos never reached the sheet
    const picked = list ? Array.from(list) : []
    if (!picked.length) return
    setFiles(prev => [...prev, ...picked].slice(0, 6))
  }

  async function saveDamage() {
    if (!dirty) { showToast('Describe the damage or add a photo'); return }
    if (!note.trim() && !hasDamageNote) { showToast('Describe the damage first'); return }
    setSaving(true)
    try {
      if (note.trim()) await post({ action: 'record_damage', productId: product.id, note, markDamaged: isDamaged ? true : markDamaged })
      if (picked.length) await post({ action: 'set_damage_photos', productId: product.id, imageIds: picked, on: true })
      let uploaded = 0
      let uploadErr = ''
      for (const f of files) {
        try {
          const fd = new FormData()
          fd.append('image', await compressImage(f))
          fd.append('productId', product.id)
          fd.append('isPrimary', 'false')
          fd.append('isDamage', 'true')
          const ur = await fetch('/api/vendor/upload', { method: 'POST', body: fd })
          if (ur.ok) uploaded++
          else uploadErr = (await ur.json().catch(() => null))?.error || `upload failed (${ur.status})`
        } catch (e: any) { uploadErr = e?.message || 'upload failed' }
      }
      const photos = uploaded + picked.length
      showToast(files.length > uploaded
        ? `⚠ Damage saved, but only ${uploaded}/${files.length} new photo(s) uploaded${uploadErr ? ` — ${uploadErr}` : ''}`
        : `⚠ Damage recorded on ${product.sku}${photos ? ` · ${photos} damage photo${photos !== 1 ? 's' : ''}` : ''}`)
      setNote(''); setFiles([]); setPicked([]); setPicking(false)
      onSaved(); await load()
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setSaving(false)
  }

  async function unmark(img: Img) {
    try {
      await post({ action: 'set_damage_photos', productId: product.id, imageIds: [img.id], on: false })
      showToast('Back to an ordinary photo'); setViewer(null); onSaved(); await load()
    } catch (e: any) { showToast('⚠ ' + e.message) }
  }

  async function saveRepaired() {
    setSaving(true)
    try {
      await post({ action: 'mark_repaired', productId: product.id, condition: repairCond, note: repairNote })
      showToast(`✓ ${product.sku} marked repaired — ${repairCond}`)
      setRepairing(false); setRepairNote(''); setRepairCond(''); onSaved(); await load()
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setSaving(false)
  }

  // ── Full-screen photo viewer: swipe or arrows, pinch to zoom ─────────────
  if (viewer) {
    const img = viewer.list[viewer.i]
    const go = (d: number) => setViewer(v => v && ({ ...v, i: (v.i + d + v.list.length) % v.list.length }))
    return (
      <div className="fixed inset-0 z-[80] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label="Damage photo">
        <div className="flex items-center justify-between px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white">
          <span className="text-sm font-bold">{viewer.i + 1} / {viewer.list.length}{img.is_damage ? (img.damage_resolved_at ? ' · before repair' : ' · damage') : ''}</span>
          <button onClick={() => setViewer(null)} aria-label="Close photo" className="w-11 h-11 rounded-full flex items-center justify-center active:bg-white/10"><X s={22} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center [touch-action:pinch-zoom_pan-x_pan-y]"
          onTouchStart={e => { swipeX.current = e.touches[0].clientX }}
          onTouchEnd={e => { const dx = e.changedTouches[0].clientX - swipeX.current; if (e.touches.length === 0 && Math.abs(dx) > 60 && viewer.list.length > 1) go(dx < 0 ? 1 : -1) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt="Damage photo" className="max-w-full max-h-full object-contain" />
        </div>
        <div className="flex items-center gap-2 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {viewer.list.length > 1 && <button onClick={() => go(-1)} className="h-12 px-5 rounded-xl bg-white/10 text-white font-bold">‹ Prev</button>}
          <span className="flex-1" />
          {img.is_damage && !img.damage_resolved_at && (
            <button onClick={() => unmark(img)} className="h-12 px-4 rounded-xl bg-white/10 text-white text-sm font-bold">Not a damage photo</button>
          )}
          {viewer.list.length > 1 && <button onClick={() => go(1)} className="h-12 px-5 rounded-xl bg-white/10 text-white font-bold">Next ›</button>}
        </div>
      </div>
    )
  }

  const thumb = (list: Img[], i: number, label?: string) => (
    <button key={list[i].id} onClick={() => setViewer({ list, i })} className="relative aspect-square rounded-xl overflow-hidden border border-slate-200 active:opacity-80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={list[i].url} alt={label || 'Damage photo'} className="w-full h-full object-cover" />
      {label && <span className="absolute left-1 bottom-1 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/60 text-white">{label}</span>}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[92dvh] overflow-hidden"
        onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="damage-title">
        <div className="sm:hidden flex justify-center pt-2.5"><span className="w-10 h-1.5 rounded-full bg-slate-200" /></div>

        {/* Header */}
        <div className="flex items-start gap-3 px-4 pt-3 pb-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <h3 id="damage-title" className="text-lg font-black text-slate-900">Damage details</h3>
            <p className="text-sm text-slate-600 leading-snug mt-0.5 break-words">{product.name}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{product.sku}</span>
              {info?.condition && <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${isDamaged ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{info.condition}</span>}
            </div>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close" className="shrink-0 w-11 h-11 -mr-1 rounded-full flex items-center justify-center text-slate-400 active:bg-slate-100"><X s={20} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5">
          {loading ? <p className="text-sm text-slate-400 text-center py-8">Loading…</p> : (<>
            {/* On record */}
            {(notes.length > 0 || openDamage.length > 0 || beforeRepair.length > 0) && (
              <section>
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">On record</p>
                {notes.length > 0 && (
                  <ul className="space-y-1.5 mb-3">
                    {notes.map((n, i) => (
                      <li key={i} className={`rounded-xl px-3 py-2 text-sm ${n.kind === 'damage' ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'}`}>
                        <span className="block text-[11px] font-black uppercase tracking-wide opacity-80">{n.kind === 'damage' ? 'Damage' : 'Repaired'} · {n.date}</span>
                        {n.text}
                      </li>
                    ))}
                  </ul>
                )}
                {openDamage.length > 0 && (
                  <>
                    <p className="text-sm font-bold text-slate-700 mb-1.5">Damage photos <span className="font-normal text-slate-400">({openDamage.length}) · tap to enlarge</span></p>
                    <div className="grid grid-cols-3 gap-2">{openDamage.map((_, i) => thumb(openDamage, i))}</div>
                  </>
                )}
                {beforeRepair.length > 0 && (
                  <>
                    <p className="text-sm font-bold text-slate-500 mt-3 mb-1.5">Before repair <span className="font-normal text-slate-400">(staff only)</span></p>
                    <div className="grid grid-cols-4 gap-2">{beforeRepair.map((_, i) => thumb(beforeRepair, i, 'before'))}</div>
                  </>
                )}
              </section>
            )}

            {/* Add damage */}
            {!adding ? (
              <button onClick={() => setAdding(true)} className="w-full h-12 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-800 font-bold text-sm active:bg-amber-100">
                + Add more damage
              </button>
            ) : (
              <section className="space-y-3">
                <p className="text-xs font-black text-slate-500 uppercase tracking-wider">{notes.length || openDamage.length ? 'Add damage' : 'Record damage'}</p>
                <div>
                  <label htmlFor="damage-note" className="block text-sm font-bold text-slate-700 mb-1.5">What&apos;s damaged?</label>
                  {/* text-base (16px): anything smaller makes iPhone zoom the page in on tap */}
                  <textarea id="damage-note" value={note} onChange={e => setNote(e.target.value)} rows={3}
                    placeholder="e.g. Deep scratch on left side, crack near mounting hole"
                    className="block w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-amber-400 resize-none" />
                </div>

                <div>
                  <p className="text-sm font-bold text-slate-700 mb-1.5">Damage photos</p>
                  <div className="grid grid-cols-3 gap-2">
                    <label className={`flex flex-col items-center justify-center gap-1 h-16 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-800 font-bold text-xs text-center active:bg-amber-100 ${files.length >= 6 ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h3l2-3h8l2 3h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></svg>
                      Camera
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
                    </label>
                    <label className={`flex flex-col items-center justify-center gap-1 h-16 rounded-xl border-2 border-slate-200 text-slate-700 font-bold text-xs text-center active:bg-slate-50 ${files.length >= 6 ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
                      Phone gallery
                      <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
                    </label>
                    <button onClick={() => setPicking(p => !p)} disabled={ordinary.length === 0}
                      className={`flex flex-col items-center justify-center gap-1 h-16 rounded-xl border-2 font-bold text-xs text-center disabled:opacity-40 ${picking ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 text-slate-700 active:bg-slate-50'}`}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><path d="M14 17l2 2 4-4" /></svg>
                      Product photos{ordinary.length ? ` (${ordinary.length})` : ''}
                    </button>
                  </div>

                  {picking && (
                    <div className="mt-2 rounded-xl border-2 border-orange-200 bg-orange-50/50 p-2">
                      <p className="text-[11px] text-slate-600 mb-1.5">Tap the photos that show the damage</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {ordinary.map(img => {
                          const on = picked.includes(img.id)
                          return (
                            <button key={img.id} onClick={() => setPicked(p => on ? p.filter(x => x !== img.id) : [...p, img.id])} aria-pressed={on}
                              className={`relative aspect-square rounded-lg overflow-hidden border-2 ${on ? 'border-orange-500' : 'border-transparent'}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img.url} alt="Product photo" className={`w-full h-full object-cover ${on ? 'opacity-80' : ''}`} />
                              {on && <span className="absolute top-1 right-1 w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {(files.length > 0 || picked.length > 0) && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {previews.map((u, i) => (
                        <div key={u} className="relative aspect-square">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt={`New photo ${i + 1}`} className="w-full h-full rounded-xl object-cover border border-slate-200" />
                          <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))} aria-label={`Remove photo ${i + 1}`}
                            className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"><X s={14} /></button>
                        </div>
                      ))}
                      {picked.map(id => {
                        const img = images.find(x => x.id === id)
                        return img ? (
                          <div key={id} className="relative aspect-square">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt="Picked product photo" className="w-full h-full rounded-xl object-cover border-2 border-orange-300" />
                            <button onClick={() => setPicked(p => p.filter(x => x !== id))} aria-label="Remove picked photo"
                              className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center"><X s={14} /></button>
                          </div>
                        ) : null
                      })}
                    </div>
                  )}
                </div>

                {!isDamaged && (
                  <label className="flex items-center gap-3 min-h-12 px-3 py-2 rounded-xl border-2 border-slate-200 cursor-pointer active:bg-slate-50">
                    <input type="checkbox" checked={markDamaged} onChange={e => setMarkDamaged(e.target.checked)} className="w-5 h-5 accent-amber-500 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">Set condition to <span className="text-amber-700">Damaged</span></span>
                  </label>
                )}
              </section>
            )}

            {/* Repaired */}
            {isDamaged && !adding && (
              repairing ? (
                <section className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 space-y-2">
                  <p className="text-sm font-black text-emerald-900">Mark repaired</p>
                  <label className="block text-xs font-bold text-slate-600">Condition now *
                    <select value={repairCond} onChange={e => setRepairCond(e.target.value)}
                      className="mt-1 block w-full h-12 px-3 rounded-xl border-2 border-slate-200 text-base bg-white outline-none focus:border-emerald-400">
                      <option value="" disabled>Choose…</option>
                      {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label className="block text-xs font-bold text-slate-600">What was done *
                    <input value={repairNote} onChange={e => setRepairNote(e.target.value)} placeholder="e.g. bracket replaced"
                      className="mt-1 block w-full h-12 px-3 rounded-xl border-2 border-slate-200 text-base bg-white outline-none focus:border-emerald-400" />
                  </label>
                  <p className="text-[11px] text-emerald-800">The damage photos stop showing to customers and stay here as &quot;before repair&quot;.</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setRepairing(false); setRepairCond(''); setRepairNote('') }} disabled={saving} className="flex-1 h-12 rounded-xl border-2 border-slate-200 bg-white text-slate-600 font-bold">Back</button>
                    <button onClick={saveRepaired} disabled={saving || !repairCond || repairNote.trim().length < 3} className="flex-[1.4] h-12 rounded-xl bg-emerald-600 text-white font-black disabled:opacity-50">{saving ? 'Saving…' : 'Mark repaired'}</button>
                  </div>
                </section>
              ) : (
                // A quiet link set well apart from the buttons — it used to be a
                // full-width button right above Close and was tapped by accident
                <div className="pt-6 mt-2 border-t border-dashed border-slate-200 text-center">
                  <button onClick={() => setRepairing(true)} className="min-h-11 px-3 text-xs font-semibold text-slate-500 underline underline-offset-2 active:text-emerald-700">
                    Fixed now? Mark as repaired…
                  </button>
                </div>
              )
            )}
          </>)}
        </div>

        {/* Actions — always visible, clear of the iPhone home bar */}
        <div className="flex gap-2 px-4 pt-3 border-t border-slate-100 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={onClose} disabled={saving} className="flex-1 h-12 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-base">{adding && dirty ? 'Cancel' : 'Close'}</button>
          {adding && (
            <button onClick={saveDamage} disabled={saving || !dirty || (!note.trim() && !hasDamageNote)}
              className="flex-[1.4] h-12 rounded-xl bg-amber-500 active:bg-amber-600 text-white font-black text-base disabled:opacity-50">
              {saving ? 'Saving…' : 'Save damage'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
