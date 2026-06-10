import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Atomically adjusts a product's stock quantity (positive delta = receive,
 * negative = deduct; clamped at 0 in the database).
 *
 * Uses the adjust_product_quantity RPC (supabase-wheelmart-phase8.sql).
 * Falls back to read-then-write if the RPC isn't deployed yet, so the app
 * keeps working before the migration runs.
 */
export async function adjustProductQuantity(
  admin: SupabaseClient,
  productId: string,
  vendorId: string,
  delta: number
): Promise<void> {
  if (!delta) return

  const { error } = await admin.rpc('adjust_product_quantity', {
    p_product_id: productId,
    p_vendor_id: vendorId,
    p_delta: delta,
  })
  if (!error) return

  // Fallback: RPC not deployed yet (or transient failure) — non-atomic path
  const { data: product } = await admin
    .from('products').select('quantity')
    .eq('id', productId).eq('vendor_id', vendorId).single()
  if (!product) return
  await admin
    .from('products')
    .update({ quantity: Math.max(0, (product.quantity || 0) + delta) })
    .eq('id', productId).eq('vendor_id', vendorId)
}
