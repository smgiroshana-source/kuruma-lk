// ─────────────────────────────────────────────────────────────────────────────
// Product damage — notes and photos (owner, 2026-10-01)
//
// Notes live in the product description as dated lines, so customers see them
// on the storefront too (owner: yes):
//   ⚠ DAMAGE (2026-10-01): crack near mounting hole
//   ✓ REPAIRED (2026-10-05): bracket replaced
// Photos are product_images flagged is_damage. Once the part is repaired the
// photo gets damage_resolved_at: kept for staff as "before repair", never
// shown to customers again.
// Used by the stock count's damage window, the back office markers and the
// storefront (cover photo, gallery order, the DAMAGE tag).
// ─────────────────────────────────────────────────────────────────────────────

export type DamageNote = { kind: 'damage' | 'repaired'; date: string; text: string }

const LINE = /^(⚠ DAMAGE|✓ REPAIRED) \((\d{4}-\d{2}-\d{2})\):\s*(.*)$/

/** Every damage / repair line in a description, newest first. */
export function damageNotes(description?: string | null): DamageNote[] {
  const out: DamageNote[] = []
  for (const raw of String(description || '').split('\n')) {
    const m = raw.trim().match(LINE)
    if (m) out.push({ kind: m[1].startsWith('⚠') ? 'damage' : 'repaired', date: m[2], text: m[3] })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

export const damageLine = (date: string, text: string) => `⚠ DAMAGE (${date}): ${text.trim()}`
export const repairedLine = (date: string, text: string) => `✓ REPAIRED (${date}): ${text.trim() || 'repaired'}`

type Img = { url: string; sort_order?: number | null; is_damage?: boolean | null; damage_resolved_at?: string | null }

/** A damage photo customers should still see: flagged and not yet repaired. */
export const isOpenDamagePhoto = (i: Img) => !!i.is_damage && !i.damage_resolved_at

/**
 * Photos as a customer sees them: ordinary photos first (in their order),
 * then open damage photos; repaired-damage photos left out. The cover is the
 * first ordinary photo — a damage photo only when there is nothing else.
 */
export function storefrontImages<T extends Img>(images: T[] | null | undefined): { ordinary: T[]; damage: T[]; all: T[]; cover: T | null } {
  const sorted = [...(images || [])].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const ordinary = sorted.filter(i => !i.is_damage)
  const damage = sorted.filter(isOpenDamagePhoto)
  const all = [...ordinary, ...damage]
  return { ordinary, damage, all, cover: all[0] || null }
}
