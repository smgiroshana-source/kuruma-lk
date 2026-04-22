/**
 * Image URL helpers.
 *
 * Images are now resized to max 1200px at upload time (see /api/vendor/upload),
 * so we no longer need Supabase Storage Image Transformations (which cost $5/1000).
 * These functions return the original URL unchanged and are kept for compatibility.
 */

export function thumbnail(url: string): string { return url || '' }
export function medium(url: string): string { return url || '' }
export function thumb64(url: string): string { return url || '' }

/** onError fallback — kept for safety but no longer strips transform params */
export function imgFallback(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget
  // Strip any legacy render/image transform URLs that may still exist in DB
  if (img.src.includes('/storage/v1/render/image/')) {
    img.src = img.src
      .replace('/storage/v1/render/image/public/', '/storage/v1/object/public/')
      .split('?')[0]
  }
}
