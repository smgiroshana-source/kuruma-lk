'use client'
// ── WHEEL MART ONLY — record damage found during a stock count, phone-first ──
//
// WHEEL MART's own copy of the shared DamageCapture sheet (owner, 2026-10-01:
// "not optimised for mobile"). Same save: a dated damage note appended to the
// description, photos to the product gallery, condition optionally Damaged.
// What changed for phones:
//   - the note box is 16px text: iPhone zooms the whole page in when a
//     smaller text box gets the cursor, which cut the sheet off on the right;
//   - no autofocus, so the keyboard doesn't open over the sheet on arrival;
//   - full width, bottom-safe-area padding, Cancel/Save pinned at the bottom;
//   - separate Take photo / From gallery buttons, bigger thumbnails and targets.
// Sakura keeps _shared/DamageCapture.tsx unchanged.
import { useEffect, useMemo, useState } from 'react'
import { compressImage } from '@/lib/compressImage'
import { colomboToday } from '@/lib/dates'

type Props = {
  product: any                 // { id, name, sku, description, condition }
  showToast: (msg: string) => void
  onClose: () => void
  onSaved: () => void          // parent refreshes its data
}

export default function DamageSheet({ product, showToast, onClose, onSaved }: Props) {
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [markDamaged, setMarkDamaged] = useState(true)
  const [saving, setSaving] = useState(false)

  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])

  // The page behind must not scroll while the sheet is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  function addFiles(list: FileList | null) {
    if (!list) return
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, 6)) // cap at 6 photos
  }

  async function save() {
    if (!note.trim()) { showToast('Describe the damage first'); return }
    setSaving(true)
    try {
      // 1. Append a dated damage note to the description (never overwrite)
      const stamp = `⚠ DAMAGE (${colomboToday()}): ${note.trim()}`
      const newDescription = product.description ? `${product.description}\n\n${stamp}` : stamp
      const data: any = { description: newDescription }
      if (markDamaged) data.condition = 'Damaged'
      const r = await fetch('/api/vendor/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', productId: product.id, data }),
      })
      const j = await r.json()
      if (!j.success) { showToast('Error: ' + (j.error || 'failed to save note')); setSaving(false); return }

      // 2. Upload photos to the product gallery (never as primary)
      let uploaded = 0
      for (const f of files) {
        try {
          const c = await compressImage(f)
          const fd = new FormData()
          fd.append('image', c)
          fd.append('productId', product.id)
          fd.append('isPrimary', 'false')
          const ur = await fetch('/api/vendor/upload', { method: 'POST', body: fd })
          if (ur.ok) uploaded++
        } catch {}
      }
      if (files.length > 0 && uploaded < files.length) {
        showToast(`⚠ Damage saved, but only ${uploaded}/${files.length} photo(s) uploaded`)
      } else {
        showToast(`⚠ Damage recorded on ${product.sku}${uploaded ? ` with ${uploaded} photo(s)` : ''}`)
      }
      onSaved()
      onClose()
    } catch {
      showToast('Network error — damage not saved')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={() => !saving && onClose()}>
      <div
        className="w-full max-w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[90dvh] overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-labelledby="damage-title"
      >
        {/* Grab handle — reads as a bottom sheet */}
        <div className="sm:hidden flex justify-center pt-2.5"><span className="w-10 h-1.5 rounded-full bg-slate-200" /></div>

        {/* Header */}
        <div className="flex items-start gap-3 px-4 pt-3 pb-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <h3 id="damage-title" className="text-lg font-black text-slate-900">Record damage</h3>
            <p className="text-sm text-slate-600 leading-snug mt-0.5 break-words">{product.name}</p>
            <span className="inline-block mt-1 font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{product.sku}</span>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Close"
            className="shrink-0 w-11 h-11 -mr-1 rounded-full flex items-center justify-center text-slate-400 active:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {/* Body — scrolls on its own if photos make it tall */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4">
          <div>
            <label htmlFor="damage-note" className="block text-sm font-bold text-slate-700 mb-1.5">What&apos;s damaged?</label>
            {/* text-base (16px): anything smaller makes iPhone zoom the page in on tap */}
            <textarea
              id="damage-note" value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="e.g. Deep scratch on left side, crack near mounting hole"
              className="block w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-amber-400 resize-none"
            />
          </div>

          <div>
            <p className="text-sm font-bold text-slate-700 mb-1.5">Photos <span className="font-normal text-slate-400">({files.length}/6)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-800 font-bold text-sm active:bg-amber-100 ${files.length >= 6 ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h3l2-3h8l2 3h3v11H3z" /><circle cx="12" cy="13" r="3.5" /></svg>
                Take photo
                <input type="file" accept="image/*" capture="environment" className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              </label>
              <label className={`flex items-center justify-center gap-2 h-12 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-bold text-sm active:bg-slate-50 ${files.length >= 6 ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 16l5-5 4 4 3-3 6 6" /></svg>
                From gallery
                <input type="file" accept="image/*" multiple className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
              </label>
            </div>
            {files.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {previews.map((u, i) => (
                  <div key={u} className="relative aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt={`Damage photo ${i + 1}`} className="w-full h-full rounded-xl object-cover border border-slate-200" />
                    <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))} aria-label={`Remove photo ${i + 1}`}
                      className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 min-h-12 px-3 py-2 rounded-xl border-2 border-slate-200 cursor-pointer active:bg-slate-50">
            <input type="checkbox" checked={markDamaged} onChange={e => setMarkDamaged(e.target.checked)} className="w-5 h-5 accent-amber-500 shrink-0" />
            <span className="text-sm font-semibold text-slate-700">Set condition to <span className="text-amber-700">Damaged</span></span>
          </label>
        </div>

        {/* Actions — always visible, clear of the iPhone home bar */}
        <div className="flex gap-2 px-4 pt-3 border-t border-slate-100 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button onClick={onClose} disabled={saving}
            className="flex-1 h-12 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-base">Cancel</button>
          <button onClick={save} disabled={saving || !note.trim()}
            className="flex-[1.4] h-12 rounded-xl bg-amber-500 active:bg-amber-600 text-white font-black text-base disabled:opacity-50">
            {saving ? 'Saving…' : 'Save damage'}
          </button>
        </div>
      </div>
    </div>
  )
}
