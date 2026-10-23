// ── A blip is not a logout (owner, 2026-10-23) ───────────────────────────────
// Staff were being thrown to the login page "without pressing Log Out". One
// cause: any failed auth check — weak mobile signal, Supabase Auth slow or
// rate-limited — read exactly like "no session", and the app sent them to
// /login. Only a missing / invalid / expired session is a real logout.
// Network errors, timeouts, 5xx and 429 are transient: say so, retry, keep
// the person where they are.

export function isTransientAuthError(error: any): boolean {
  if (!error) return false
  if (error.name === 'AuthRetryableFetchError') return true          // network / fetch failed
  const status = Number(error.status ?? error.code ?? 0)
  return status === 0 || status === 408 || status === 429 || status >= 500
}
