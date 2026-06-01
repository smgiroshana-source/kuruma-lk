/**
 * URL slug utilities for product pages.
 *
 * Slug format: {name}-{condition}
 * Example: "aqua-front-bumper-reconditioned"
 *
 * We do NOT prepend make/model because vendors already include vehicle info
 * in the product name (e.g. "Honda Fit GP5 Axel LHS"). Prepending make+model
 * would double it: "honda-fit-honda-fit-gp5-axel-lhs-reconditioned".
 *
 * Slugs are generated once at product creation and never changed —
 * changing a slug breaks existing Google-indexed URLs.
 */

export function generateProductSlug(
  name: string,
  _make?: string | null,
  _model?: string | null,
  condition?: string | null,
): string {
  const parts = [name, condition].filter(Boolean) as string[]
  const slug = parts
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric → hyphens
    .replace(/-+/g, '-')            // collapse runs of hyphens
    .replace(/^-|-$/g, '')          // trim leading/trailing hyphens
    .slice(0, 120)                   // cap length
  return slug || 'part'
}

/** Returns true if the string looks like a Supabase UUID. */
export function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}
