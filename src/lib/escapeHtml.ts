// For print templates built via string interpolation — customer names,
// addresses, product names, notes etc. are user-entered and must be escaped
// before being injected into document.write() HTML.
export function escapeHtml(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
