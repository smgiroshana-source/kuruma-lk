import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'

/**
 * Product pages are cached (ISR). Every stock change — sale, return, GRN,
 * transfer, write-off, count — goes through adjustProductQuantity, so this is
 * where the page is told to refresh: the "in stock" wording, the noindex on a
 * sold-out part and the JSON-LD availability Google reads. Never fails the
 * stock change it follows.
 */
export async function revalidateProductPage(admin: SupabaseClient, productId: string): Promise<void> {
  try {
    const { data } = await admin.from('products').select('slug').eq('id', productId).maybeSingle()
    if (data?.slug) revalidatePath(`/product/${data.slug}`)
    revalidatePath(`/product/${productId}`)
  } catch { /* outside a request (scripts) or a lookup blip — the 7-day refresh catches it */ }
}

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
  if (!error) { await revalidateProductPage(admin, productId); return }

  // Fallback: RPC not deployed yet (or transient failure) — non-atomic path
  const { data: product } = await admin
    .from('products').select('quantity')
    .eq('id', productId).eq('vendor_id', vendorId).single()
  if (!product) return
  await admin
    .from('products')
    .update({ quantity: Math.max(0, (product.quantity || 0) + delta) })
    .eq('id', productId).eq('vendor_id', vendorId)
  await revalidateProductPage(admin, productId)
}
