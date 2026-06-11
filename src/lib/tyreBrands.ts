// Tyre brand detection + signature colours for generated product thumbnails.
//
// These are NOT the brands' logo artwork — we render the brand *name* in its
// recognised signature colour as our own original badge. A `logo` slot is left
// for dropping in an official logo file later (public/brand-logos/<slug>.png),
// which the thumbnail will prefer when present.
//
// `keywords` are matched case-insensitively against the product name. Longer
// keywords win, so "GT RADIAL" beats a stray "GT". Order within a region does
// not matter; detection ranks purely by matched-keyword length.

export type TyreBrand = {
  slug: string          // file name for an optional real logo (brand-logos/<slug>.png)
  name: string          // display name on the badge
  color: string         // signature background colour
  text?: string         // text colour over `color` (default white)
  origin: 'Japan' | 'China' | 'Europe' | 'Korea' | 'India' | 'Indonesia' | 'Sri Lanka' | 'Thailand' | 'Taiwan' | 'USA' | 'Other'
  keywords: string[]
}

export const TYRE_BRANDS: TyreBrand[] = [
  // ── Japanese ──────────────────────────────────────────────────────────────
  { slug: 'bridgestone', name: 'Bridgestone', color: '#cc0000', origin: 'Japan', keywords: ['BRIDGESTONE'] },
  { slug: 'dunlop',      name: 'Dunlop',      color: '#ffd100', text: '#1a1a1a', origin: 'Japan', keywords: ['DUNLOP'] },
  { slug: 'toyo',        name: 'Toyo',        color: '#e2231a', origin: 'Japan', keywords: ['TOYO', 'TTM'] },
  { slug: 'yokohama',    name: 'Yokohama',    color: '#c8102e', origin: 'Japan', keywords: ['YOKOHAMA'] },
  { slug: 'falken',      name: 'Falken',      color: '#0033a0', origin: 'Japan', keywords: ['FALKEN'] },

  // ── Korean ────────────────────────────────────────────────────────────────
  { slug: 'hankook',   name: 'Hankook',   color: '#ee3124', origin: 'Korea', keywords: ['HANKOOK'] },
  { slug: 'kumho',     name: 'Kumho',     color: '#e4002b', origin: 'Korea', keywords: ['KUMHO'] },
  { slug: 'nexen',     name: 'Nexen',     color: '#003da5', origin: 'Korea', keywords: ['NEXEN'] },
  { slug: 'roadstone', name: 'Roadstone', color: '#0046ad', origin: 'Korea', keywords: ['ROADSTONE'] },
  { slug: 'laufenn',   name: 'Laufenn',   color: '#00a3a1', origin: 'Korea', keywords: ['LAUFENN'] },

  // ── European ──────────────────────────────────────────────────────────────
  { slug: 'michelin',    name: 'Michelin',    color: '#2a3d8f', origin: 'Europe', keywords: ['MICHELIN'] },
  { slug: 'continental', name: 'Continental', color: '#ff9e1b', text: '#1a1a1a', origin: 'Europe', keywords: ['CONTINENTAL', 'CON '] },
  { slug: 'pirelli',     name: 'Pirelli',     color: '#d2122e', origin: 'Europe', keywords: ['PIRELLI'] },
  { slug: 'ferentino',   name: 'Ferentino',   color: '#9c1d2b', origin: 'Europe', keywords: ['FERENTINO'] },
  { slug: 'vredestein',  name: 'Vredestein',  color: '#e2001a', origin: 'Europe', keywords: ['VREDESTEIN'] },

  // ── Chinese ───────────────────────────────────────────────────────────────
  { slug: 'linglong',   name: 'Linglong',   color: '#d7000f', origin: 'China', keywords: ['LINGLONG', 'LING LONG'] },
  { slug: 'triangle',   name: 'Triangle',   color: '#e60012', origin: 'China', keywords: ['TRIANGLE'] },
  { slug: 'westlake',   name: 'Westlake',   color: '#003a8c', origin: 'China', keywords: ['WESTLAKE'] },
  { slug: 'goodride',   name: 'Goodride',   color: '#e30613', origin: 'China', keywords: ['GOODRIDE', 'GOOD RIDE'] },
  { slug: 'comforser',  name: 'Comforser',  color: '#1a7a3d', origin: 'China', keywords: ['COMFORSER'] },
  { slug: 'three-a',    name: 'Three-A',    color: '#c8102e', origin: 'China', keywords: ['THREE-A', 'THREE A', '(THREE A)'] },
  { slug: 'kapsen',     name: 'Kapsen',     color: '#e2001a', origin: 'China', keywords: ['KAPSEN', 'RASSURER'] },
  { slug: 'ilink',      name: 'I-Link',     color: '#0066b3', origin: 'China', keywords: ['I LINK', 'I-LINK', 'ILINK'] },
  { slug: 'grenlander', name: 'Grenlander', color: '#1f8a4c', origin: 'China', keywords: ['GRENLANDER'] },
  { slug: 'tracmax',    name: 'Tracmax',    color: '#005bac', origin: 'China', keywords: ['TRACMAX'] },
  { slug: 'fronway',    name: 'Fronway',    color: '#e2001a', origin: 'China', keywords: ['FRONWAY'] },
  { slug: 'atlander',   name: 'Atlander',   color: '#005bac', origin: 'China', keywords: ['ATLANDER'] },
  { slug: 'leao',       name: 'Leao',       color: '#d2122e', origin: 'China', keywords: ['LEAO'] },
  { slug: 'goodtrip',   name: 'Goodtrip',   color: '#0066b3', origin: 'China', keywords: ['GOODTRIP'] },
  { slug: 'onyx',       name: 'Onyx',       color: '#222222', origin: 'China', keywords: ['ONYX'] },
  { slug: 'rapid',      name: 'Rapid',      color: '#d2122e', origin: 'China', keywords: ['RAPID'] },
  { slug: 'yeada',      name: 'Yeada',      color: '#0066b3', origin: 'China', keywords: ['YEADA'] },
  { slug: 'tbb',        name: 'TBB',        color: '#e2001a', origin: 'China', keywords: ['TBB'] },
  { slug: 'ovation',    name: 'Ovation',    color: '#003a8c', origin: 'China', keywords: ['OVETION', 'OVATION'] },
  { slug: 'kinto',      name: 'Kinto',      color: '#1b6ca8', origin: 'China', keywords: ['KINTO'] },
  { slug: 'comformax',  name: 'Com-Max',    color: '#c0392b', origin: 'China', keywords: ['COM - MAX', 'COM-MAX', 'COMMAX'] },
  { slug: 'runway',     name: 'Runway',     color: '#e30613', origin: 'China', keywords: ['RUNWAY'] },
  { slug: 'dovroad',    name: 'Dovroad',    color: '#0066b3', origin: 'China', keywords: ['DOVROAD'] },
  { slug: 'arpidag',    name: 'Arpidag',    color: '#0a6e3a', origin: 'China', keywords: ['ARPIDAG', 'APIDAG', 'DAG '] },
  { slug: 'brawo',      name: 'Brawo',      color: '#b8860b', text: '#1a1a1a', origin: 'China', keywords: ['BRAWO', 'ORION'] },

  // ── Indian ────────────────────────────────────────────────────────────────
  { slug: 'ceat',   name: 'CEAT',   color: '#0057a8', origin: 'India', keywords: ['CEAT'] },
  { slug: 'mrf',    name: 'MRF',    color: '#0046ad', origin: 'India', keywords: ['MRF'] },
  { slug: 'apollo', name: 'Apollo', color: '#e4002b', origin: 'India', keywords: ['APOLLO'] },
  { slug: 'jktyre', name: 'JK Tyre', color: '#1d4e9c', origin: 'India', keywords: ['JK TYRE', 'JK-TYRE'] },
  { slug: 'maruti', name: 'Maruti', color: '#c0392b', origin: 'India', keywords: ['MARUTI'] },

  // ── Indonesian ────────────────────────────────────────────────────────────
  { slug: 'gtradial', name: 'GT Radial', color: '#e2001a', origin: 'Indonesia', keywords: ['GT RADIAL', '(G.T)', 'G.T)', 'GAJAH TUNGGAL'] },
  { slug: 'forceum',  name: 'Forceum',   color: '#1a1a1a', origin: 'Indonesia', keywords: ['FORCEUM'] },
  { slug: 'achilles', name: 'Achilles',  color: '#c8102e', origin: 'Indonesia', keywords: ['ACHILLES'] },

  // ── Sri Lankan ────────────────────────────────────────────────────────────
  { slug: 'gri',      name: 'GRI',      color: '#5a9e2f', origin: 'Sri Lanka', keywords: ['GRI '] },
  { slug: 'dsi',      name: 'DSI',      color: '#e2001a', origin: 'Sri Lanka', keywords: ['DSI'] },
  { slug: 'kelani',   name: 'Kelani',   color: '#0057a8', origin: 'Sri Lanka', keywords: ['KELANI'] },
  { slug: 'loadstar', name: 'Loadstar', color: '#1a7a3d', origin: 'Sri Lanka', keywords: ['LOADSTAR'] },
  { slug: 'arpico',   name: 'Arpico',   color: '#e30613', origin: 'Sri Lanka', keywords: ['ARPICO', 'ARL '] },
  { slug: 'dolfin',   name: 'Dolfin',   color: '#1b6ca8', origin: 'Sri Lanka', keywords: ['DOLFIN', 'DOLFINE'] },
  { slug: 'timsun',   name: 'Timsun',   color: '#1a1a1a', origin: 'Sri Lanka', keywords: ['TIMSUN'] },

  // ── Thai ──────────────────────────────────────────────────────────────────
  { slug: 'deestone', name: 'Deestone', color: '#e2001a', origin: 'Thailand', keywords: ['DEESTONE'] },
  { slug: 'lenso',    name: 'Lenso',    color: '#1a1a1a', origin: 'Thailand', keywords: ['LENSO'] },

  // ── Taiwan ────────────────────────────────────────────────────────────────
  { slug: 'maxxis', name: 'Maxxis', color: '#003da5', origin: 'Taiwan', keywords: ['MAXXIS'] },
  { slug: 'kenda',  name: 'Kenda',  color: '#e2001a', origin: 'Taiwan', keywords: ['KENDA'] },

  // ── Other ─────────────────────────────────────────────────────────────────
  { slug: 'blackhawk',  name: 'Blackhawk',  color: '#1a1a1a', origin: 'USA',   keywords: ['BLACKHAWK', 'BLACK HAWK'] },
  { slug: 'ultramile',  name: 'Ultramile',  color: '#005bac', origin: 'Other', keywords: ['ULTRAMILE'] },
  { slug: 'comforser2', name: 'Goodtrip',   color: '#0066b3', origin: 'China', keywords: ['GOOD TRIP'] },
  { slug: 'westlake2',  name: 'Westlake',   color: '#003a8c', origin: 'China', keywords: ['W/L'] },
  { slug: 'emtrac',     name: 'Emtrac',     color: '#1d8348', origin: 'Sri Lanka', keywords: ['EMTRAC'] },
  { slug: 'comforser3', name: 'I Link',     color: '#0066b3', origin: 'China', keywords: ['ILINK'] },
]

// Pre-flatten keyword → brand for ranked matching (longest keyword wins).
const KEYWORD_INDEX: { kw: string; brand: TyreBrand }[] = TYRE_BRANDS
  .flatMap(b => b.keywords.map(kw => ({ kw: kw.toUpperCase(), brand: b })))
  .sort((a, b) => b.kw.length - a.kw.length)

// Brands for which an official logo file has been added at
// public/brand-logos/<slug>.png. Add a slug here AFTER dropping its file in so
// the thumbnail prefers the real logo — keeping this list explicit avoids 404
// request storms for the (many) brands that have only the generated badge.
export const BRANDS_WITH_LOGO = new Set<string>([
  // e.g. 'toyo', 'continental', 'dunlop', 'ceat', 'gri'
])

/** Detect the tyre/auto brand embedded in a product name, or null if none known. */
export function detectTyreBrand(name: string | null | undefined): TyreBrand | null {
  if (!name) return null
  const hay = name.toUpperCase()
  for (const { kw, brand } of KEYWORD_INDEX) {
    if (hay.includes(kw)) return brand
  }
  return null
}

/** Stable distinct colour for an unknown brand/product so tiles never look identical. */
export function fallbackColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue} 45% 38%)`
}

/** Pick readable text colour (black/white) for a given hex background. */
export function readableText(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  // Relative luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#1a1a1a' : '#ffffff'
}
