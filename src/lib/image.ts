/**
 * Supabase Image Transformation helpers.
 * Converts public storage URLs to render URLs with resize/quality params.
 * Requires Supabase Pro plan.
 *
 * /storage/v1/object/public/...  →  /storage/v1/render/image/public/...?width=W&quality=Q
 */

function transform(url: string, width: number, quality = 75): string {
  if (!url) return url
  return url.replace(
    '/storage/v1/object/public/',
    '/storage/v1/render/image/public/'
  ) + `?width=${width}&quality=${quality}`
}

/** ~400px wide, quality 75 — for product listing cards */
export function thumbnail(url: string): string {
  return transform(url, 400)
}

/** ~800px wide, quality 80 — for product detail main image */
export function medium(url: string): string {
  return transform(url, 800, 80)
}

/** 128px wide, quality 60 — for small thumbnail strips */
export function thumb64(url: string): string {
  return transform(url, 128, 60)
}
