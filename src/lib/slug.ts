/**
 * URL slug utilities for product pages.
 *
 * Slug format: {make}-{model}-{name}-{condition}
 * Example: "toyota-aqua-front-bumper-reconditioned"
 *
 * Slugs are generated once at product creation and never changed —
 * changing a slug breaks existing Google-indexed URLs.
 */

export function generateProductSlug(
  name: string,
  make?: string | null,
  model?: string | null,
  condition?: string | null,
): string {
  const parts = [make, model, name, condition].filter(Boolean) as string[]
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
