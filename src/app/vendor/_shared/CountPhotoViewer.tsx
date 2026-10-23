'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Browse & Count photo check (owner, 2026-10-23): tap a part's photo or name
// to see every photo of it full screen, so staff can check the system's
// photos match the part in their hand — and fix them on the spot:
//   📷 Add photo   camera or gallery (the phone offers both)
//   ⭐ Make main   this photo leads, on the count card and the storefront
//   🗑 Remove      gone for good, after "Are you sure?" (owner: staff decide —
//                  no review queue)
// Uses /api/vendor/images (list / reorder / delete) and /api/vendor/upload.
// Phone rules: big targets, no tiny text boxes, actions clear of the home bar.
import { useCallback, useEffect, useState } from 'react'
import { compressImage } from '@/lib/compressImage'

type Img = { id: string; url: string; sort_order: number; is_damage?: boolean; damage_resolved_at?: string | null }

export default function CountPhotoViewer({ product, onClose, onChanged, showToast }: {
  product: any                  // { id, sku, name, loc_* }
  onClose: () => void
  onChanged: () => void         // parent refreshes its product list
  showToast: (msg: string) => void
}) {
  const [images, setImages] = useState<Img[] | null>(null)
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(false)
  const [busy, setBusy] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [touchX, setTouchX] = useState<number | null>(null)

  const load = useCallback(async (): Promise<Img[]> => {
    try {
      const r = await fetch('/api/vendor/images?productIds=' + product.id, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not load photos')
      const list: Img[] = (j.images?.[product.id] || []).slice()
        // the product's own photos first, damage photos after (as everywhere)
        .sort((a: Img, b: Img) => (a.is_damage ? 1 : 0) - (b.is_damage ? 1 : 0) || a.sort_order - b.sort_order)
      setImages(list)
      setI(x => Math.min(x, Math.max(0, list.length - 1)))
      return list
    } catch (e: any) { showToast('⚠ ' + e.message); setImages([]); return [] }
  }, [product.id, showToast])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images?.length])

  const n = images?.length || 0
  const cur = images && n ? images[i] : null
  function go(d: number) { if (n > 1) { setI(x => (x + d + n) % n); setZoom(false); setConfirmDelete(false) } }

  async function post(body: any) {
    const r = await fetch('/api/vendor/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw new Error(j.error || 'Could not save')
  }

  async function addPhotos(list: FileList | null) {
    // Copy NOW — the input is cleared right after this call
    const files = list ? Array.from(list) : []
    if (!files.length) return
    setBusy('upload')
    let ok = 0, err = ''
    const before = (images || []).filter(x => !x.is_damage).map(x => x.id)
    const added: string[] = []
    for (const f of files.slice(0, 6)) {
      try {
        const fd = new FormData()
        fd.append('image', await compressImage(f))
        fd.append('productId', product.id)
        fd.append('isPrimary', 'false')
        const r = await fetch('/api/vendor/upload', { method: 'POST', body: fd })
        const j = await r.json().catch(() => null)
        if (r.ok) { ok++; if (j?.image?.id) added.push(j.image.id) }
        else err = j?.error || `upload failed (${r.status})`
      } catch (e: any) { err = e?.message || 'upload failed' }
    }
    showToast(ok === files.length ? `📷 ${ok} photo${ok !== 1 ? 's' : ''} added to ${product.sku}` : `⚠ ${ok}/${files.length} uploaded${err ? ' — ' + err : ''}`)
    // Uploads all land at position 0 — put them AFTER the existing photos so
    // the main photo never changes by accident (Make main does that on purpose)
    if (before.length && added.length) {
      try { await post({ action: 'reorder', imageOrder: [...before, ...added] }) } catch {}
    }
    const fresh = await load()
    // Show the newest photo
    const at = added.length ? fresh.findIndex(x => x.id === added[added.length - 1]) : -1
    if (at >= 0) setI(at)
    onChanged()
    setBusy('')
  }

  async function makeMain() {
    if (!images || !cur || i === 0) return
    setBusy('main')
    try {
      const own = images.filter(x => !x.is_damage)
      const order = [cur.id, ...own.filter(x => x.id !== cur.id).map(x => x.id)]
      await post({ action: 'reorder', imageOrder: order })
      showToast('⭐ Main photo changed')
      await load(); setI(0); onChanged()
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setBusy('')
  }

  async function remove() {
    if (!cur) return
    setBusy('delete')
    try {
      await post({ action: 'delete', imageId: cur.id })
      showToast('🗑 Photo removed')
      setConfirmDelete(false)
      await load(); onChanged()
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setBusy('')
  }

  const loc = [product.loc_store, product.loc_floor, product.loc_sub1, product.loc_sub2].filter(Boolean).join(' › ')
  const btn = 'min-h-12 rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-40'

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col" role="dialog" aria-modal="true" aria-label={`Photos of ${product.name}`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-black/80 text-white">
        <div className="flex-1 min-w-0">
          <p className="font-bold leading-tight">{product.name}</p>
          <p className="text-xs text-white/70 mt-0.5"><span className="font-mono">{product.sku}</span>{loc ? ` · 📍 ${loc}` : ''}</p>
        </div>
        <button onClick={onClose} aria-label="Close photos" className="w-11 h-11 -mr-1 rounded-xl flex items-center justify-center text-white active:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      {/* Photo */}
      <div className="relative flex-1 min-h-0"
        onTouchStart={e => { if (!zoom) setTouchX(e.touches[0].clientX) }}
        onTouchEnd={e => { if (touchX != null) { const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); setTouchX(null) } }}>
        {images === null ? (
          <p className="absolute inset-0 flex items-center justify-center text-white/60 text-sm">Loading photos…</p>
        ) : !cur ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70 text-sm px-8 text-center">
            <span className="text-4xl">📷</span>
            <p>No photo of this part yet.</p>
            <p className="text-white/50 text-xs">Take one with “Add photo” below.</p>
          </div>
        ) : (
          <div className={`absolute inset-0 ${zoom ? 'overflow-auto' : 'overflow-hidden flex items-center justify-center'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cur.url} alt={`${product.name} — photo ${i + 1} of ${n}`} onClick={() => setZoom(z => !z)}
              className={zoom ? 'max-w-none w-[250%]' : 'max-w-full max-h-full object-contain'} />
          </div>
        )}
        {cur?.is_damage && (
          <span className="absolute top-3 left-3 bg-amber-500 text-white text-[11px] font-black px-2 py-1 rounded-md">{cur.damage_resolved_at ? 'BEFORE REPAIR' : 'DAMAGE'}</span>
        )}
        {i === 0 && cur && !cur.is_damage && n > 1 && <span className="absolute top-3 left-3 bg-white/90 text-slate-900 text-[11px] font-black px-2 py-1 rounded-md">MAIN</span>}
        {n > 1 && !zoom && (
          <>
            <button onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white text-2xl flex items-center justify-center">‹</button>
            <button onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/50 text-white text-2xl flex items-center justify-center">›</button>
            <span className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs font-bold px-2.5 py-1 rounded-full">{i + 1} / {n}</span>
          </>
        )}
        {cur && <span className="absolute bottom-3 right-3 text-white/50 text-[10px]">{zoom ? 'tap to fit' : 'tap to zoom'}</span>}
      </div>

      {/* Thumbnails */}
      {n > 1 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto bg-black/80">
          {images!.map((im, k) => (
            <button key={im.id} onClick={() => { setI(k); setZoom(false); setConfirmDelete(false) }} aria-label={`Photo ${k + 1}`}
              className={`relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 ${k === i ? 'border-orange-500' : 'border-transparent opacity-70'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" loading="lazy" className="w-full h-full object-cover" />
              {im.is_damage && <span className="absolute bottom-0 inset-x-0 bg-amber-500 text-white text-[8px] font-black text-center">DAMAGE</span>}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="bg-slate-900 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {confirmDelete ? (
          <div className="space-y-2">
            <p className="text-white text-sm font-bold text-center">Remove this photo for good? It can&apos;t be undone.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmDelete(false)} disabled={!!busy} className={`${btn} bg-white/10 text-white`}>Cancel</button>
              <button onClick={remove} disabled={!!busy} className={`${btn} bg-red-600 text-white`}>{busy === 'delete' ? 'Removing…' : 'Yes, remove'}</button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <label className={`${btn} bg-orange-600 text-white cursor-pointer ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
              {busy === 'upload' ? 'Uploading…' : '📷 Add photo'}
              <input type="file" accept="image/*" multiple className="hidden" onChange={e => { addPhotos(e.target.files); e.target.value = '' }} />
            </label>
            <button onClick={makeMain} disabled={!!busy || !cur || i === 0 || !!cur?.is_damage} className={`${btn} bg-white/10 text-white`}>
              {busy === 'main' ? 'Saving…' : '⭐ Make main'}
            </button>
            <button onClick={() => setConfirmDelete(true)} disabled={!!busy || !cur} className={`${btn} bg-white/10 text-red-300`}>🗑 Remove</button>
          </div>
        )}
      </div>
    </div>
  )
}
