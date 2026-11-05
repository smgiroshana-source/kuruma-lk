// ── What a /[make] page is really about (SEO, 2026-11-05) ────────────────────
// `make` holds the tyre brand for tyres and tubes, so 41 brand pages (Rapid,
// Linglong, Toyo, Maruti, DSI …) went to Google as "Linglong Parts Sri Lanka —
// spare parts & accessories". Nobody searches that; people search "Linglong
// tyres price". A brand whose stock is mostly tyres / tubes / flaps is named
// for what it sells, and lists its sizes. Car makes stay "Parts".

export type BrandNoun = 'Parts' | 'Tyres' | 'Tubes' | 'Tyres & Tubes'
export type BrandKind = {
  noun: BrandNoun
  isTyreBrand: boolean
  sizes: { label: string; slug: string; count: number }[]  // tyre sizes in stock, most stocked first
}

const isTyreish = (p: any) => p?.product_type === 'tyre' || p?.category === 'Wheels & Tires'
const isTubeOrFlap = (p: any) => /\b(tube|flap)s?\b/i.test(String(p?.name || ''))

export function brandKind(products: any[]): BrandKind {
  const total = products.length
  const tyreish = products.filter(isTyreish)
  if (total === 0 || tyreish.length / total < 0.5) return { noun: 'Parts', isTyreBrand: false, sizes: [] }

  const tubes = tyreish.filter(isTubeOrFlap).length
  const tyres = tyreish.length - tubes
  const noun: BrandNoun = tyres && tubes ? 'Tyres & Tubes' : tubes ? 'Tubes' : 'Tyres'

  const bySize = new Map<string, { label: string; slug: string; count: number }>()
  for (const p of tyreish) {
    if (isTubeOrFlap(p) || !p.tyre_width || !p.tyre_profile || !p.tyre_rim) continue
    const slug = `${p.tyre_width}-${p.tyre_profile}-r${p.tyre_rim}`
    const cur = bySize.get(slug) || { label: `${p.tyre_width}/${p.tyre_profile}R${p.tyre_rim}`, slug, count: 0 }
    cur.count += Number(p.quantity) > 0 ? Number(p.quantity) : 1
    bySize.set(slug, cur)
  }
  const sizes = [...bySize.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { noun, isTyreBrand: true, sizes }
}
