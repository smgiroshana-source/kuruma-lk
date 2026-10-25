// ── The storefront's ONE address (2026-10-25) ───────────────────────────────
// Vercel serves www.kuruma.lk; kuruma.lk redirects to it. The env variable
// NEXT_PUBLIC_SITE_URL said https://kuruma.lk, so every canonical tag, og:url
// and sitemap entry pointed at an address that redirects — Google could never
// settle a page's address, and ~5,000 of 5,500 pages sat "not indexed".
// Every canonical, sitemap and share URL comes from here. If the primary
// domain ever changes in Vercel, change it here — nowhere else.
export const SITE_URL = 'https://www.kuruma.lk'
