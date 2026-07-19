'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Bottom-sheet for recording damage found during a stock count: a dated damage
// note is appended to the product description and photos (straight from the
// phone camera) are uploaded to the product gallery. Optionally flips the
// product's condition to "Damaged".
import { useState } from 'react'
import { compressImage } from '@/lib/compressImage'
import { colomboToday } from '@/lib/dates'

type Props = {
  product: any                 // { id, name, sku, description, condition }
  showToast: (msg: string) => void
  onClose: () => void
  onSaved: () => void          // parent refreshes its data
}

export default function DamageCapture({ product, showToast, onClose, onSaved }: Props) {
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [markDamaged, setMarkDamaged] = useState(true)
  const [saving, setSaving] = useState(false)

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
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 w-full sm:max-w-md max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-900">⚠ Record Damage</h3>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              <span className="font-mono bg-slate-100 px-1 py-0.5 rounded">{product.sku}</span> {product.name}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-2xl font-bold leading-none shrink-0">✕</button>
        </div>

        <label className="block text-xs font-bold text-slate-500 mb-1">What&apos;s damaged?</label>
        <textarea
          value={note} onChange={e => setNote(e.target.value)} rows={3} autoFocus
          placeholder="e.g. Deep scratch on left side, crack near mounting hole…"
          className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-amber-400 resize-none"
        />

        {/* Camera / photo picker — capture="environment" opens the rear camera on phones */}
        <div className="mt-3">
          <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700 font-bold text-sm cursor-pointer active:bg-amber-100">
            📷 Take / add photos
            <input type="file" accept="image/*" capture="environment" multiple className="hidden"
              onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          </label>
          {files.length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {files.map((f, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={URL.createObjectURL(f)} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                  <button onClick={() => setFiles(prev => prev.filter((_, x) => x !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-xs font-bold leading-none">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input type="checkbox" checked={markDamaged} onChange={e => setMarkDamaged(e.target.checked)} className="w-4 h-4 accent-amber-500" />
          <span className="text-sm font-semibold text-slate-700">Set condition to <span className="text-amber-700">Damaged</span></span>
        </label>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={saving}
            className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-500 font-bold text-sm">Cancel</button>
          <button onClick={save} disabled={saving || !note.trim()}
            className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save damage'}
          </button>
        </div>
      </div>
    </div>
  )
}
