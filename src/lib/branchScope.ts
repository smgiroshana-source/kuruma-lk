import { createAdminClient } from '@/lib/supabase/admin'

// Which side of the business a sale belongs to is carried by its invoice
// entity: the shop bills as PART/PROP, the workshop as REPR/WPRO. A login can
// be limited to one side (vendor_staff.branch_scope); owners see both and may
// filter by choice via a ?branch= query param.

export type Branch = 'shop' | 'workshop'

/** Entity ids for a branch, plus whether legacy/no-entity sales belong to it. */
export async function branchEntityIds(vendorId: string, branch: Branch) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('invoice_entities')
    .select('id, branch, serial_qqqq')
    .eq('vendor_id', vendorId)
  const rows = data || []
  const isWorkshop = (e: any) => (e.branch ? e.branch === 'workshop' : ['REPR', 'WPRO'].includes(e.serial_qqqq))
  return rows.filter(e => (branch === 'workshop' ? isWorkshop(e) : !isWorkshop(e))).map(e => e.id)
}

/**
 * Resolves the branch a request should be limited to.
 * - a scoped staff login is pinned to its own branch, whatever it asks for
 * - owners and 'both' logins get whatever ?branch= asks for (null = everything)
 */
export function resolveBranch(callerScope: string | undefined, requested: string | null): Branch | null {
  if (callerScope === 'shop' || callerScope === 'workshop') return callerScope
  return requested === 'shop' || requested === 'workshop' ? requested : null
}

/**
 * Applies a branch filter to a PostgREST query over `sales`.
 * Shop includes sales with no entity (older rows predate the entity split).
 */
export function applyBranchFilter(query: any, branch: Branch | null, entityIds: string[]) {
  if (!branch) return query
  if (branch === 'workshop') {
    return entityIds.length > 0 ? query.in('invoice_entity_id', entityIds) : query.eq('invoice_entity_id', '00000000-0000-0000-0000-000000000000')
  }
  return entityIds.length > 0
    ? query.or(`invoice_entity_id.in.(${entityIds.join(',')}),invoice_entity_id.is.null`)
    : query.is('invoice_entity_id', null)
}

/**
 * Same rule, applied through an EMBEDDED sales relation — for queries that
 * start at `payments` and join `sales!inner`. Without this a payments-based
 * figure (credit collections, returns) ignores the branch filter entirely and
 * shows the SAME total under Shop, Workshop and All, so the two sides appear
 * to sum to double the real amount.
 */
export function applyBranchFilterOnSales(query: any, branch: Branch | null, entityIds: string[]) {
  if (!branch) return query
  if (branch === 'workshop') {
    return entityIds.length > 0
      ? query.in('sales.invoice_entity_id', entityIds)
      : query.eq('sales.invoice_entity_id', '00000000-0000-0000-0000-000000000000')
  }
  return entityIds.length > 0
    ? query.or(`invoice_entity_id.in.(${entityIds.join(',')}),invoice_entity_id.is.null`, { foreignTable: 'sales' })
    : query.is('sales.invoice_entity_id', null)
}
