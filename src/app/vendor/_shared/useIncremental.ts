'use client'
// ── Shared by BOTH vendors — draw a long list a page at a time ───────────────
// Browse & Count drew every card at once — 741 at WHEEL MART, up to 5,536 at
// Sakura, each with a photo, buttons and a counter — and redrew them all on
// every + / − tap (owner, 2026-10-24: "takes time to load"). This shows the
// first `step` and adds the next `step` as the end of the list scrolls near,
// so the screen opens at once. Everything else (counts, print, Excel) still
// uses the full list. Pure browser work — no server calls.
import { useEffect, useRef, useState } from 'react'

export function useIncremental<T>(items: T[], resetKey: string, step = 60) {
  const [limit, setLimit] = useState(step)
  // A new filter / search / stop starts again from the top
  useEffect(() => { setLimit(step) }, [resetKey, step])

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || limit >= items.length || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting)) setLimit(l => l + step) },
      { rootMargin: '800px 0px' },   // start drawing well before the end is on screen
    )
    io.observe(el)
    return () => io.disconnect()
  }, [limit, items.length, step])

  return {
    visible: items.length > limit ? items.slice(0, limit) : items,
    remaining: Math.max(0, items.length - limit),
    showMore: () => setLimit(l => l + step),
    sentinelRef,
  }
}
