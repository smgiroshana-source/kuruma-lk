'use client'
import { useState, useEffect } from 'react'

/**
 * How many shipments another shop has sent us that nobody here has answered.
 *
 * Stock used to appear in the receiving shop's inventory with no notice at all.
 * The Transfer tab now asks for an answer, but a panel only helps someone who
 * already opened that tab — so the count is surfaced as a badge on the tab
 * itself, which is the actual notice.
 *
 * Lives in _shared because both vendors are on both ends of a transfer, but
 * each renders its own tab bar, so each calls this from its own TabStock.
 */
export function useIncomingTransferCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const r = await fetch('/api/vendor/stock-transfer?action=incoming')
        if (!r.ok) return
        const j = await r.json()
        if (alive) setCount(j.pendingCount || 0)
      } catch {}
    }
    load()
    // A shipment arrives when the other shop sends it, not when this page
    // reloads — poll gently so the badge appears during a shift.
    const t = setInterval(load, 120_000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return count
}
