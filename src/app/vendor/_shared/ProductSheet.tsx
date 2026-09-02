'use client'

// ─────────────────────────────────────────────────────────────────────────────
// The product screen for a phone, and the "pieces taken off this" panel that
// both it and the desktop edit modal share.
//
// The old mobile path was: tap a tile → dark overlay with three buttons → Edit
// → a modal built for a desktop, scrolled to its very bottom to find "Remove a
// piece". At the bench, with a phone in one hand and a mirror in the other,
// that is four screens to do one thing.
//
// Now a tap opens a bottom sheet: the photos, the facts, four large actions,
// and the pieces list — with removing a piece one tap away and the camera
// first. Shared by both vendors.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) : ''

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

async function api(body: any) {
  const r = await fetch('/api/vendor/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  return r.json()
}

// ═════════════════════════════════════════════════════════════════════════════
// PartOutPanel — list of pieces removed from an assembly, and the form to
// remove another. Self-contained: fetches its own list, owns its own form.
// ═════════════════════════════════════════════════════════════════════════════
export function PartOutPanel({
  product, showToast, uploadImages, onCostMoved, onChanged, openSignal = 0, hideAddButton = false,
}: {
  product: any
  showToast: (m: string) => void
  uploadImages: (productId: string, files: File[]) => Promise<any[]>
  /** Cost that left the assembly — so the caller can keep its own copy honest. */
  onCostMoved?: (moved: number) => void
  onChanged?: () => void
  /** Increment to open the form and scroll to it — the sheet's action button. */
  openSignal?: number
  /** The sheet has its own large "Remove a piece" action; showing the panel's
      too put the same button on screen twice. The desktop modal keeps it. */
  hideAddButton?: boolean
}) {
  const [partOuts, setPartOuts] = useState<any[] | null>(null)
  const [form, setForm] = useState<{ name: string; description: string; price: string; cost: string } | null>(null)
  const [photos, setPhotos] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)
  // One preview URL per file, made once and released when the file leaves.
  // Creating a fresh object URL on every render leaked them and made the
  // thumbnails flicker as the form re-rendered while typing.
  const previewsRef = useRef(new Map<File, string>())
  const previewOf = (f: File) => {
    let u = previewsRef.current.get(f)
    if (!u) { u = URL.createObjectURL(f); previewsRef.current.set(f, u) }
    return u
  }
  useEffect(() => {
    const live = new Set(photos)
    for (const [f, u] of previewsRef.current) if (!live.has(f)) { URL.revokeObjectURL(u); previewsRef.current.delete(f) }
  }, [photos])
  useEffect(() => () => { for (const u of previewsRef.current.values()) URL.revokeObjectURL(u) }, [])

  async function load() {
    if (!product?.id) { setPartOuts(null); return }
    try {
      const j = await api({ action: 'part_outs', productId: product.id })
      setPartOuts(j.partOuts || [])
    } catch { setPartOuts([]) }
  }
  useEffect(() => { setPartOuts(null); load() }, [product?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (openSignal > 0) {
      setForm({ name: '', description: '', price: '', cost: '' })
      setPhotos([])
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    }
  }, [openSignal])

  const canRemove = !product?.parent_product_id && Number(product?.quantity) > 0
  const parentCost = Number(product?.cost) || 0

  async function save() {
    if (!form || !form.name.trim()) return
    setSaving(true)
    try {
      const j = await api({
        action: 'part_out', parentId: product.id, name: form.name,
        description: form.description, price: form.price || null, costAssigned: form.cost || 0,
      })
      if (!j.success) { showToast('⚠️ ' + (j.error || 'Could not remove the piece')); setSaving(false); return }
      if (photos.length > 0 && j.product?.id) {
        showToast(`Uploading ${photos.length} photo${photos.length !== 1 ? 's' : ''}…`)
        await uploadImages(j.product.id, photos)
      }
      showToast('✅ ' + j.message)
      const moved = Math.max(0, Math.round(Number(form.cost) || 0))
      setForm(null); setPhotos([])
      onCostMoved?.(moved)
      await load()
      onChanged?.()
    } catch { showToast('Network error') }
    setSaving(false)
  }

  // Read the files NOW. The state updater runs after this handler returns, and
  // by then the line that resets the input has already emptied its file list —
  // so the picked photos vanished and the strip stayed blank. That is what the
  // owner saw on the phone: take the picture, nothing appears.
  const addPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    e.currentTarget.value = ''
    if (picked.length === 0) return
    setPhotos(prev => [...prev, ...picked])
  }

  return (
    <div className="border-2 border-indigo-200 bg-indigo-50/40 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-black text-indigo-900">🔧 Pieces taken off this</p>
          <p className="text-[11px] text-indigo-700 leading-snug">A mirror off a door, a condenser off a radiator. Each becomes its own item — sell it, hold it, or transfer it.</p>
        </div>
        {canRemove && !form && !hideAddButton && (
          <button type="button"
            onClick={() => { setForm({ name: '', description: '', price: '', cost: '' }); setPhotos([]) }}
            className="shrink-0 min-h-[44px] px-3 rounded-lg bg-indigo-600 text-white text-xs font-bold active:bg-indigo-700">
            + Remove a piece
          </button>
        )}
      </div>

      {product?.parent_product_id && (
        <p className="text-[11px] text-indigo-700 font-semibold mb-1">This is itself a piece removed from another assembly.</p>
      )}

      {partOuts === null ? (
        <p className="text-xs text-slate-400">Checking…</p>
      ) : partOuts.length === 0 ? (
        !form && <p className="text-xs text-slate-400">Nothing removed — this is still complete.</p>
      ) : (
        <div className="space-y-1.5">
          {partOuts.map((po: any) => (
            <div key={po.id} className="bg-white border border-indigo-100 rounded-lg px-2.5 py-2 flex items-start gap-2.5">
              {po.child?.image
                ? <img src={po.child.image} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover border border-indigo-100 shrink-0" />
                : <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-100 shrink-0 flex items-center justify-center text-slate-300 text-xl">🔧</div>}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 leading-tight">{po.description}{po.quantity > 1 ? ` ×${po.quantity}` : ''}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {po.child ? <span className="font-mono">{po.child.sku}</span> : 'item deleted'} · {day(po.removedAt)}
                  {po.costAssigned > 0 ? ` · ${rs(po.costAssigned)} of cost moved` : ''}
                </p>
                <p className="text-[11px] font-bold mt-0.5">
                  {po.sold
                    ? <span className="text-emerald-700">SOLD · {po.sold.doc}</span>
                    : po.child && Number(po.child.quantity) > 0
                      ? <span className="text-blue-700">IN STOCK · {po.child.quantity}</span>
                      : <span className="text-slate-400">gone</span>}
                </p>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-indigo-800 font-semibold pt-0.5">
            ⚠️ No longer complete — {partOuts.length} piece{partOuts.length !== 1 ? 's' : ''} removed.
          </p>
        </div>
      )}

      {form && (
        <div ref={formRef} className="mt-2.5 bg-white border-2 border-indigo-300 rounded-xl p-3 space-y-3 scroll-mt-4">
          {/* Camera first. At the bench the photo is the natural first move,
              and it is the one thing that cannot be added by typing later. */}
          <div>
            <p className="text-[11px] font-bold text-slate-500 mb-1.5">Photos of the piece</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center justify-center gap-1.5 min-h-[52px] rounded-xl border-2 border-indigo-300 bg-indigo-50 text-indigo-700 text-sm font-bold active:bg-indigo-100 cursor-pointer">
                📷 Take photo
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addPhotos} />
              </label>
              <label className="flex items-center justify-center gap-1.5 min-h-[52px] rounded-xl border-2 border-slate-200 text-slate-600 text-sm font-bold active:bg-slate-50 cursor-pointer">
                🖼️ Gallery
                <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
              </label>
            </div>
            {photos.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((f, n) => (
                    <div key={n} className="relative shrink-0">
                      <img src={previewOf(f)} alt="" className="w-20 h-20 rounded-lg object-cover border-2 border-indigo-200" />
                      {n === 0 && <span className="absolute bottom-0 inset-x-0 bg-indigo-600/85 text-white text-[9px] font-bold text-center rounded-b-md">MAIN</span>}
                      <button type="button" onClick={() => setPhotos(prev => prev.filter((_, k) => k !== n))}
                        className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-red-500 text-white text-sm font-bold leading-none">×</button>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-indigo-700 font-semibold">{photos.length} photo{photos.length !== 1 ? 's' : ''} — the first is the main picture</p>
              </div>
            )}
          </div>

          <input autoFocus={photos.length === 0} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="What is the piece? e.g. RHS side mirror"
            className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-indigo-400" />
          <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2}
            placeholder="Condition, notes (optional)"
            className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm outline-none resize-none focus:border-indigo-400" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Selling price</label>
              <input type="number" inputMode="numeric" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Cost to move across</label>
              <input type="number" inputMode="numeric" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })}
                className="w-full px-3 py-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-indigo-400" />
              <p className="text-[10px] text-slate-400 mt-1">This assembly carries {rs(parentCost)}. Whatever you move comes off it.</p>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => { setForm(null); setPhotos([]) }}
              className="flex-1 min-h-[52px] rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
            <button type="button" disabled={saving || !form.name.trim()} onClick={save}
              className="flex-[2] min-h-[52px] rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40 active:bg-indigo-700">
              {saving ? 'Removing…' : 'Remove the piece'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// ProductSheet — the phone's product screen. A bottom sheet.
// ═════════════════════════════════════════════════════════════════════════════
export function ProductSheet({
  product, onClose, onEdit, onSell, showToast, uploadImages, onChanged, costLabel,
}: {
  product: any
  onClose: () => void
  onEdit: (p: any) => void
  onSell: (p: any) => void
  showToast: (m: string) => void
  uploadImages: (productId: string, files: File[]) => Promise<any[]>
  onChanged: () => void
  /** Vendor-specific cost rendering (WHEEL MART shows VAT wording); optional. */
  costLabel?: (p: any) => string
}) {
  const [p, setP] = useState<any>(product)
  const [openSignal, setOpenSignal] = useState(0)
  const [slide, setSlide] = useState(0)
  const [uploading, setUploading] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)
  // Set when photos are added; consumed by the effect below once the strip
  // has actually re-rendered with them. Scrolling on a timer after the upload
  // was undone a moment later, when the merged list came in and the
  // snap-mandatory strip re-snapped to the first slide.
  const scrollToEndRef = useRef(false)
  const imageCount = (p?.images || []).length
  useEffect(() => {
    if (!scrollToEndRef.current) return
    // Instant, not smooth: a smooth scroll on a snap-mandatory strip is
    // cancelled the moment the list re-renders, and the strip re-snaps to the
    // first slide — while the counter, set by hand, said "5 / 5" over slide
    // one. The counter now comes only from the real scroll position (see
    // onStripScroll), and the jump is repeated once after the refetch has
    // had time to re-render, then the intent is cleared.
    const jump = () => stripRef.current?.lastElementChild?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'end' })
    requestAnimationFrame(() => requestAnimationFrame(jump))
    const again = setTimeout(() => { jump(); scrollToEndRef.current = false }, 900)
    return () => clearTimeout(again)
  }, [imageCount])
  // When the parent hands down a fresh copy, MERGE its images with ours rather
  // than replacing them. The refresh that follows an upload is answered by the
  // server a moment after the insert, and if it arrives carrying the list from
  // just before, a straight replace throws away the photo that was added
  // seconds ago — it came back later, but the sheet had already said "1 / 7"
  // and then "4 / 4". Keyed by id, so a later refresh that does include it
  // simply dedupes.
  useEffect(() => {
    setP((cur: any) => {
      if (!cur || cur.id !== product?.id) return product
      const seen = new Set((product?.images || []).map((i: any) => i.id))
      const extra = (cur.images || []).filter((i: any) => i?.id && !seen.has(i.id))
      return { ...product, images: [...(product?.images || []), ...extra] }
    })
  }, [product])

  const images: any[] = (p?.images || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
  const inStock = Number(p?.quantity) > 0

  // Lock the page behind the sheet, and let the phone's back gesture close it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const onStripScroll = () => {
    const el = stripRef.current
    if (!el || !el.clientWidth) return
    setSlide(Math.round(el.scrollLeft / el.clientWidth))
  }

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.currentTarget.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      const added = await uploadImages(p.id, files)
      // Show them now, from the records the server returned. The refetch that
      // follows may still be answered from cache; this cannot be.
      if (added.length > 0) {
        scrollToEndRef.current = true
        setP((cur: any) => ({ ...cur, images: [...(cur.images || []), ...added] }))
        showToast(`✅ ${added.length} photo${added.length !== 1 ? 's' : ''} added`)
      }
      onChanged()
    } catch { showToast('Upload failed') }
    setUploading(false)
  }

  if (!p) return null
  return (
    <div className="fixed inset-0 z-[65] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="relative w-full max-h-[94vh] bg-white rounded-t-3xl overflow-y-auto overscroll-contain shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle + close */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 pt-2 pb-1 flex items-center justify-between">
          <div className="w-10 h-1.5 rounded-full bg-slate-300 mx-auto absolute left-1/2 -translate-x-1/2 top-2.5" />
          <span className="text-[11px] font-mono font-bold text-slate-400">{p.sku}</span>
          <button onClick={onClose} className="min-w-[44px] min-h-[44px] -mr-2 text-slate-500 text-2xl leading-none" aria-label="Close">×</button>
        </div>

        {/* Photos — swipe through them */}
        <div className="relative bg-slate-100">
          {images.length > 0 ? (
            <div ref={stripRef} onScroll={onStripScroll} className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none">
              {images.map((img: any, i: number) => (
                <img key={img.id || i} src={img.url} alt="" loading="eager"
                  className="w-full aspect-[4/3] object-cover shrink-0 snap-center"
                  // A photo added a moment ago can be asked for before storage
                  // is ready to serve it. The browser then remembers the
                  // failure and shows a grey box for a file that is perfectly
                  // good — which reads as "the upload did not work". Retry a
                  // few times with a fresh URL; a load that succeeds first
                  // time never comes through here.
                  onError={e => {
                    const el = e.currentTarget
                    const n = Number(el.dataset.retry || 0)
                    if (n >= 3) return
                    el.dataset.retry = String(n + 1)
                    setTimeout(() => { el.src = img.url + (img.url.includes('?') ? '&' : '?') + 'r=' + Date.now() }, 700 * (n + 1))
                  }} />
              ))}
            </div>
          ) : (
            <div className="w-full aspect-[4/3] flex items-center justify-center text-slate-300 text-5xl">📦</div>
          )}
          {images.length > 1 && (
            <span className="absolute bottom-2 right-3 bg-black/60 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">
              {slide + 1} / {images.length}
            </span>
          )}
          {!inStock && <span className="absolute top-2 left-3 bg-red-500 text-white text-[11px] font-bold px-2 py-0.5 rounded">SOLD OUT</span>}
          {!p.is_active && inStock && <span className="absolute top-2 left-3 bg-slate-600 text-white text-[11px] font-bold px-2 py-0.5 rounded">HIDDEN</span>}
        </div>

        <div className="px-4 pt-3 pb-6 space-y-4">
          {/* The facts */}
          <div>
            <h2 className="text-lg font-black text-slate-900 leading-snug">{p.name}</h2>
            <div className="flex items-baseline gap-3 mt-1 flex-wrap">
              <span className="text-2xl font-black text-orange-600">{p.price ? rs(p.price) : 'Ask'}</span>
              <span className={'text-sm font-bold px-2 py-0.5 rounded-full ' + (inStock ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600')}>
                {inStock ? `${p.quantity} in stock` : 'none left'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {[p.make && `${p.make} ${p.model || ''}`.trim(), p.category, p.condition].filter(Boolean).join(' · ')}
              {p.cost != null && Number(p.cost) > 0 && ` · cost ${rs(p.cost)}${costLabel ? costLabel(p) : ''}`}
            </p>
            {(p.loc_store || p.loc_sub1) && (
              <p className="text-xs font-semibold text-amber-700 mt-1">📍 {[p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ')}</p>
            )}
          </div>

          {/* Four big actions. Thumb-sized, no menu, no scrolling to find them. */}
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => onSell(p)} disabled={!inStock}
              className="min-h-[60px] rounded-2xl bg-emerald-500 text-white font-bold text-sm active:bg-emerald-600 disabled:opacity-30 flex flex-col items-center justify-center">
              <span className="text-xl leading-none mb-0.5">🛒</span>Sell now
            </button>
            <button onClick={() => setOpenSignal(n => n + 1)} disabled={!inStock || !!p.parent_product_id}
              className="min-h-[60px] rounded-2xl bg-indigo-600 text-white font-bold text-sm active:bg-indigo-700 disabled:opacity-30 flex flex-col items-center justify-center">
              <span className="text-xl leading-none mb-0.5">🔧</span>Remove a piece
            </button>
            <label className={'min-h-[60px] rounded-2xl border-2 border-slate-200 text-slate-700 font-bold text-sm active:bg-slate-50 flex flex-col items-center justify-center cursor-pointer ' + (uploading ? 'opacity-50' : '')}>
              <span className="text-xl leading-none mb-0.5">📷</span>{uploading ? 'Uploading…' : 'Add photos'}
              <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={addPhotos} disabled={uploading} />
            </label>
            <button onClick={() => onEdit(p)}
              className="min-h-[60px] rounded-2xl border-2 border-slate-200 text-slate-700 font-bold text-sm active:bg-slate-50 flex flex-col items-center justify-center">
              <span className="text-xl leading-none mb-0.5">✏️</span>Edit details
            </button>
          </div>

          <PartOutPanel
            product={p} showToast={showToast} uploadImages={uploadImages} openSignal={openSignal} hideAddButton
            onCostMoved={moved => setP((cur: any) => ({ ...cur, cost: Math.max(0, (Number(cur.cost) || 0) - moved) }))}
            onChanged={onChanged}
          />
        </div>
      </div>
    </div>
  )
}
