// ─────────────────────────────────────────────────────────────────────────────
// Small, boring security helpers. Each exists because the review of
// 2026-09-02 found the thing it prevents.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'

/**
 * JSON that is safe to put inside a <script> tag.
 *
 * JSON.stringify does not escape '<', so a product named
 *   </script><script>…</script>
 * dropped into a JSON-LD block breaks out of the tag and runs on every
 * visitor's browser. Product names are typed by vendors — and, until the RLS
 * lock-down, could be written by anyone at all. Escaping the four characters
 * that matter keeps the JSON valid and inert.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Free text that will be interpolated into a PostgREST filter string such as
 *   .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
 *
 * The filter grammar uses , ( ) . and quotes as structure. A search term
 * carrying them can close the current clause and open another. Rows stay
 * scoped by the separate .eq('vendor_id', …) — PostgREST ANDs parameters —
 * so the reach is limited, but the query must not be attacker-shaped at all.
 */
export function pgSafe(input: unknown, max = 80): string {
  return String(input ?? '')
    .replace(/[,()"'\\%*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/**
 * Who may do the destructive things.
 *
 * Reversing a GRN, reversing a payment, refunding an advance, deleting an
 * expense or a write-off, settling a customer's whole balance — all of these
 * were open to any active login, including a cashier. The role lives on
 * vendor_staff and is read server-side by each route's getVendor; this only
 * decides whether that role is enough.
 */
export type Role = 'owner' | 'manager' | 'cashier' | string
export function roleAllows(role: Role | null | undefined, allowed: Role[]): boolean {
  return !!role && allowed.includes(role)
}
export function forbidden(what: string, allowed: Role[]) {
  return NextResponse.json(
    { error: `${what} needs ${allowed.join(' or ')} — ask the ${allowed[0]} to do it.` },
    { status: 403 },
  )
}

/**
 * Upload guard: refuse before the whole body is buffered into memory.
 * 10 MB, the same as Next's own request-body cap: above that the framework
 * truncates the body and the parse fails with a 500 that names nothing. A
 * phone photo is 3–12 MB; the client compresses to ~125 KB before sending,
 * so a genuine photo never comes near this.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
