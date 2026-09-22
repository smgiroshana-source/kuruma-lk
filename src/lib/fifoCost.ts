/**
 * FIFO cost layers — consuming, restoring, and the live picture of what's
 * actually on the shelf.
 *
 * products.cost is a cached single number for the many places that just want
 * one figure (the "Missing cost" filter, CSV export, the Profit Report's
 * fallback when a sale carries no snapshot, older screens). It is kept close
 * to right by refreshing it here, at every point stock moves through
 * consumeFifoCost/restoreFifoCost — but a single number can never be exactly
 * right once a product holds more than one cost at once (owner, 2026-09-22:
 * "2 at 5,000, 4 at 6,000"). For that, read the layers directly:
 * getRemainingLayers() for the full picture, previewFifoCost() for what a
 * specific quantity would really cost, without consuming anything.
 *
 * Always consume/restore through the functions here, never call the
 * consume_fifo_cost / restore_fifo_cost RPCs directly — a call site that
 * skips the refresh is exactly how the reference cost goes stale.
 */

type Admin = any

export type CostLayer = {
  id?: string
  unit_cost: number
  quantity_remaining: number
  received_at?: string
  created_at?: string
}

/** The layers actually left to sell, oldest first — the order a real sale draws from. */
export async function getRemainingLayers(admin: Admin, vendorId: string, productId: string): Promise<CostLayer[]> {
  const { data } = await admin.from('cost_layers')
    .select('id, unit_cost, quantity_remaining, received_at, created_at')
    .eq('vendor_id', vendorId).eq('product_id', productId)
    .gt('quantity_remaining', 0)
    .order('received_at', { ascending: true }).order('created_at', { ascending: true })
  return data || []
}

/**
 * What a sale of `quantity` units would really cost, walking the layers in
 * the same oldest-first order the database does — a read-only preview,
 * nothing is consumed. Returns null when there is nothing to price it
 * against. `covered` can be less than `quantity` when stock runs short; the
 * figure returned still prices only the units it actually has a cost for.
 */
export function previewFifoCost(layers: CostLayer[], quantity: number): { totalCost: number; avgCost: number; covered: number; breakdown: { qty: number; unit_cost: number }[] } | null {
  let remaining = Math.max(0, Math.round(quantity))
  if (remaining <= 0 || layers.length === 0) return null
  let totalCost = 0, covered = 0
  const breakdown: { qty: number; unit_cost: number }[] = []
  for (const layer of layers) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Math.round(layer.quantity_remaining))
    if (take <= 0) continue
    const unitCost = Math.round(layer.unit_cost)
    totalCost += take * unitCost
    covered += take
    breakdown.push({ qty: take, unit_cost: unitCost })
    remaining -= take
  }
  if (covered === 0) return null
  return { totalCost, avgCost: Math.round(totalCost / covered), covered, breakdown }
}

/**
 * products.cost tracks the OLDEST remaining layer — the cost of the very
 * next unit that will actually be sold, the same FIFO rule the rest of the
 * app already follows for stock valuation. Left untouched when no layer
 * remains, so a stock-out doesn't erase the last known figure.
 */
export async function refreshProductCost(admin: Admin, vendorId: string, productId: string): Promise<void> {
  const layers = await getRemainingLayers(admin, vendorId, productId)
  if (layers.length === 0) return
  await admin.from('products').update({ cost: Math.round(layers[0].unit_cost) }).eq('id', productId).eq('vendor_id', vendorId)
}

/** Consume stock from the oldest layers, then refresh the cached reference
 * cost. Returns the TOTAL cost consumed (whole LKR), same as the RPC. */
export async function consumeFifoCost(admin: Admin, vendorId: string, productId: string, quantity: number): Promise<number> {
  const { data, error } = await admin.rpc('consume_fifo_cost', {
    p_vendor_id: vendorId, p_product_id: productId, p_quantity: quantity,
  })
  if (error) throw error
  await refreshProductCost(admin, vendorId, productId)
  return Number(data) || 0
}

/** Restore a layer (void/return/fix), then refresh the cached reference cost. */
export async function restoreFifoCost(admin: Admin, vendorId: string, productId: string, quantity: number, unitCost: number, receivedAt: string): Promise<void> {
  const { error } = await admin.rpc('restore_fifo_cost', {
    p_vendor_id: vendorId, p_product_id: productId,
    p_quantity: quantity, p_unit_cost: unitCost, p_received_at: receivedAt,
  })
  if (error) throw error
  await refreshProductCost(admin, vendorId, productId)
}
