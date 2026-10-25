// ── A written description for every product page (owner, 2026-10-25) ────────
// 96% of live products had no description of their own, and the page carried
// one templated sentence — Google read thousands of near-identical pages as
// thin (Search Console: soft 404 / crawled-not-indexed). This writes a real
// description from the facts on record: name, condition, make, model, model
// code, side, colour, part number, tyre size, origin, stock, seller, damage
// notes — plus honest buying advice for that kind of part.
//
// Rules: every sentence is either a recorded fact or general advice that is
// true for the category. Never invent a warranty, a test, a mileage or a
// fitment the data doesn't state. The seller's own text stays and is shown
// as "Seller's notes".
import { damageNotes } from './damage'

export type DescribedProduct = {
  name: string
  description?: string | null
  category?: string | null
  condition?: string | null
  make?: string | null
  model?: string | null
  model_code?: string | null
  year?: string | number | null
  side?: string | null
  color?: string | null
  oem_code?: string | null
  sku?: string | null
  quantity?: number | string | null
  price?: number | string | null
  show_price?: boolean | null
  tyre_width?: number | string | null
  tyre_profile?: number | string | null
  tyre_rim?: number | string | null
  origin_country?: string | null
}

export type ProductCopy = {
  summary: string            // ~160 chars: meta description, JSON-LD, share cards
  paragraphs: string[]       // "About this part"
  checks: string[]           // "Before you buy"
  sellerNotes: string        // the seller's own text, damage lines removed
  damage: string | null      // the newest open damage note, if any
}

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').replace(/,(\S)/g, ', $1').trim()
// "HONDA" → "Honda", but leave codes and mixed case ("BMW", "RAV4") as typed
const titleCase = (s: string) => (s && s === s.toUpperCase() && /[A-Z]{4,}/.test(s))
  ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s
const has = (hay: string, needle: string) => !!needle && hay.toLowerCase().includes(needle.toLowerCase())

function sideLabel(side: string): string {
  const k = side.toLowerCase().replace(/[^a-z ]/g, '').trim()
  if (k === 'lhs' || k === 'lh' || k === 'left') return 'left-hand side (LHS)'
  if (k === 'rhs' || k === 'rh' || k === 'right') return 'right-hand side (RHS)'
  return k   // "front", "rear left" …
}
const isLeftRight = (side: string) => /left|right|\b(l|r)hs?\b/i.test(side)

function conditionPhrase(c: string): { short: string; long: string } {
  const k = c.toLowerCase()
  if (k.startsWith('recondition')) return {
    short: 'Reconditioned',
    long: 'It is reconditioned: a used original part taken from a vehicle, not a new replacement.',
  }
  if (k === 'new-genuine') return { short: 'Brand-new genuine', long: 'It is brand new and genuine (original manufacturer part).' }
  if (k === 'new-other') return { short: 'Brand-new', long: 'It is brand new, from a maker other than the original manufacturer.' }
  if (k === 'new') return { short: 'Brand-new', long: 'It is brand new.' }
  if (k === 'damaged') return { short: 'Damaged', long: 'It is sold as damaged — read the damage notes and look at the damage photos before you decide.' }
  return { short: c, long: '' }
}

// Honest, general advice by category — true for any part in it
const CATEGORY_ADVICE: Record<string, string> = {
  'Body Parts': 'Body panels are usually supplied in the colour they came off the vehicle, so most need paint matching before fitting. Check the photos for the mounting tabs, clips and edges.',
  'Lighting': 'Lamps are side-specific and the connector differs between versions, so compare the photos with the lamp on your vehicle — especially the shape, the plug and any projector or LED unit.',
  'Brake System': 'Brake parts are safety-critical: have them fitted and tested by a qualified mechanic.',
  'Suspension & Steering': 'Suspension and steering parts affect handling and safety; fit them through a qualified mechanic and check the wheel alignment afterwards.',
  'Safety': 'Safety equipment such as airbags and seat-belt units must be installed by a qualified technician.',
  'Electrical & Electronics': 'Electronic units are often matched by part number — compare the number printed on your existing unit with the one in the photos before you buy.',
  'Engine Parts': 'Engine parts vary between engine codes even within one model, so confirm your engine code as well as the model.',
  'A/C & Radiator': 'A/C and cooling parts differ between engine and A/C versions; compare the pipe positions and mounting points in the photos with your vehicle.',
  'Wheels & Tires': '',
  'Interior Parts': 'Interior parts vary by trim level and colour; compare the photos with your vehicle\'s interior.',
  'Hybrid & EV Parts': 'Hybrid components such as batteries, inverters and their control units should be fitted and checked by a technician familiar with hybrid systems.',
  'Transmission & Drivetrain': 'Transmission parts differ between gearbox types (auto, CVT, manual) and drive layouts — confirm your gearbox code before ordering.',
  'Windscreen': 'Windscreens differ by sensor and heating options; check for rain-sensor, camera or heating features against your vehicle.',
}

export function describeProduct(p: DescribedProduct, seller?: { name?: string | null; location?: string | null }): ProductCopy {
  const name = clean(p.name)
  const make = titleCase(clean(p.make)), model = titleCase(clean(p.model))
  // The model code on record — unless the name carries a DIFFERENT code
  // (Alto "HA36S" battery recorded as MA36S): then name neither, and ask the
  // buyer to confirm with the seller rather than state a code that may be wrong
  const recorded = clean(p.model_code)
  const nameCodes = (clean(p.name).match(/\b[A-Z]{1,4}\d{1,3}[A-Z]{0,2}\b/g) || []).filter(t => /\d/.test(t))
  // "MH55" vs "MH55S", "AHR20" vs "AHR20W" are one vehicle written two ways
  const sameCode = (a: string, b: string) => { const x = a.toUpperCase(), y = b.toUpperCase(); return x.startsWith(y) || y.startsWith(x) }
  const codeConflict = !!recorded && nameCodes.length > 0 && !nameCodes.some(t => sameCode(t, recorded))
  // No code on record but one in the name ("Honda Fit GP1") — use the name's
  const code = codeConflict ? '' : (recorded || (nameCodes.length === 1 ? nameCodes[0] : ''))
  const vehicle = [make, model].filter(Boolean).join(' ')
  const tyreRow = !!(p.tyre_width && p.tyre_profile && p.tyre_rim)
  let cond = conditionPhrase(clean(p.condition))
  // A new tyre is just new — "a maker other than the original manufacturer" is a parts idea
  if (tyreRow && cond.short === 'Brand-new') cond = { short: 'Brand-new', long: 'It is brand new.' }
  const side = clean(p.side), colour = titleCase(clean(p.color)), oem = clean(p.oem_code), sku = clean(p.sku)
  const origin = clean(p.origin_country), category = clean(p.category)
  const qty = Number(p.quantity) || 0
  const tyre = p.tyre_width && p.tyre_profile && p.tyre_rim ? { w: Number(p.tyre_width), p: Number(p.tyre_profile), r: Number(p.tyre_rim) } : null
  const tyreSize = tyre ? `${tyre.w}/${tyre.p}R${tyre.r}` : ''
  const sellerName = titleCase(clean(seller?.name)), sellerLoc = clean(seller?.location)
  const priced = !!(p.show_price && Number(p.price) > 0)
  const price = priced ? `Rs.${Number(p.price).toLocaleString('en-LK')}` : ''

  // The seller's own words, without the dated damage / repair lines
  const own = String(p.description || '').split('\n')
    .filter(l => !/^(⚠ DAMAGE|✓ REPAIRED) \(/.test(l.trim())).join('\n').trim()
  const openDamage = damageNotes(p.description).find(n => n.kind === 'damage') || null
  const repairedAfter = openDamage ? damageNotes(p.description).find(n => n.kind === 'repaired' && n.date >= openDamage.date) : null
  const damage = openDamage && !repairedAfter ? openDamage.text : null

  const paragraphs: string[] = []

  // 1 — what it is and what it fits
  // Don't repeat what the name already says ("Honda Vezel RV5 Head Lamp")
  const nameHasVehicle = has(name, model) || (!model && has(name, make))
  const fits = tyre ? ''
    : nameHasVehicle ? (code && !has(name, code) ? ` (model code ${code})` : '')
    : vehicle ? ` for the ${vehicle}${code ? ` (model code ${code})` : ''}` : ''
  paragraphs.push(
    `${cond.short ? cond.short + ' ' : ''}${name}${fits}.` +
    (cond.long ? ` ${cond.long}` : '') +
    (side ? (isLeftRight(side) ? ` This is the ${sideLabel(side)} part.` : ` Position: ${sideLabel(side)}.`) : '') +
    (colour ? ` Colour: ${colour}.` : '') +
    (origin ? ` Origin: ${origin}.` : ''),
  )

  // 2 — fitment: what to check so it fits
  if (tyre) {
    paragraphs.push(
      `Tyre size ${tyreSize}: ${tyre.w} mm wide, with a sidewall ${tyre.p}% of the width, for a ${tyre.r}-inch rim. ` +
      `The size is printed on the sidewall of your current tyres — match all three numbers.`,
    )
  } else if (code) {
    paragraphs.push(
      `Model codes matter more than model names: the same ${model || 'model'} is built in several generations with different codes, and parts often differ between them. ` +
      `Check that your vehicle's code is ${code} — it is the start of the chassis (frame) number on the registration document.`,
    )
  } else if (vehicle) {
    paragraphs.push(codeConflict
      ? `Parts can differ between generations of the ${vehicle}. Confirm the model code on your vehicle's registration (the start of the chassis number) with the seller before buying.`
      : `Confirm the year and model code of your ${vehicle} with the seller before buying; parts can differ between generations.`)
  }

  // 3 — honest advice for this kind of part
  const advice = CATEGORY_ADVICE[category]
  if (advice) paragraphs.push(advice)

  // 4 — buying it
  paragraphs.push(
    (qty > 0 ? (qty === 1 ? 'One unit is in stock' : `${qty} units are in stock`) : 'This part is currently sold out') +
    (sellerName ? ` at ${sellerName}${sellerLoc ? `, ${sellerLoc}` : ''}` : '') + '. ' +
    (priced ? `Price: ${price}. ` : 'Prices follow the market — ask the seller for today\'s price; quotes are free. ') +
    (sku ? `Quote part ID ${sku}${oem ? ` (part number ${oem})` : ''} when you contact the seller.` : ''),
  )

  const checks = [
    tyre ? `Size ${tyreSize} matches your current tyres` : code ? `Your vehicle's model code is ${code}` : vehicle ? `It suits your generation of ${vehicle} — confirm the model code with the seller` : '',
    side ? (isLeftRight(side) ? `You need the ${sideLabel(side)}` : `It is the ${sideLabel(side)} one you need`) : '',
    oem ? `The part number matches ${oem}` : '',
    category === 'Body Parts' ? 'You have allowed for paint matching' : '',
    damage ? `You have read the damage note: "${damage}"` : '',
  ].filter(Boolean)

  const summary = [
    `${cond.short ? cond.short + ' ' : ''}${name}${fits}.`,
    damage ? `Damage: ${damage}.` : '',
    qty > 0 ? (sellerName ? `In stock at ${sellerName}${sellerLoc ? `, ${sellerLoc}` : ''}.` : 'In stock.') : 'Sold out.',
    sku ? `Part ID ${sku}.` : '',
    priced ? `Price ${price}.` : 'Ask for today\'s price.',
  ].filter(Boolean).join(' ').slice(0, 300)

  return { summary, paragraphs: paragraphs.filter(Boolean), checks, sellerNotes: own, damage }
}
