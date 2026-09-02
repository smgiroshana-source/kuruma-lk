import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
  // Refreshes the session cookie, and tells the page guard below who this is.
  const { data: { user } } = await supabase.auth.getUser()

  // Shop data is never cacheable. Without an explicit header the browser is
  // free to heuristically cache a GET — Safari does it eagerly — so a screen
  // kept showing yesterday's stock or a sale that had already been recorded
  // until someone hit reload (owner-reported, 2026-08-25). Every /api response
  // says no-store; the storefront is not matched by this middleware and keeps
  // its CDN caching.
  const path = request.nextUrl.pathname
  const method = request.method.toUpperCase()

  // ── CSRF: a state-changing API call must come from this site ──────────
  // Auth is a cookie, so a page on another origin could POST here with the
  // user's session attached. SameSite=Lax already stops most of it; this
  // makes it explicit. The workshop app calls /api/workshop/* cross-origin
  // by design and carries a bearer token, not a cookie — it is exempt.
  if (path.startsWith('/api/') && !path.startsWith('/api/workshop/') && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const origin = request.headers.get('origin')
    const referer = request.headers.get('referer')
    const self = request.nextUrl.origin
    const from = origin || (referer ? new URL(referer).origin : null)
    if (from && from !== self) {
      return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
    }
  }

  // ── Signed-out visitors do not get the app shell ───────────────────────
  // Every API route checks the session itself, so no data leaked; but the
  // vendor and admin pages rendered for anyone and then failed quietly.
  if ((path.startsWith('/vendor') || path.startsWith('/admin')) && !user) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.searchParams.set('next', path)
    return NextResponse.redirect(login)
  }

  if (path.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store, must-revalidate')
    response.headers.set('Pragma', 'no-cache')
  }

  return response
}

// Only the surfaces that actually use a server-side session. The storefront
// (/, /product, /tyres, /[make]) is ISR-cached anonymous HTML — running this
// function in front of it billed Active CPU on every cache hit (7,754 product
// URLs × crawlers = the Hobby overage of Aug 2026) and added a Supabase
// auth round trip to every signed-in page view. Storefront auth is
// client-side (AuthProvider); server-side cookie reads exist only in /api.
export const config = {
  matcher: [
    '/api/:path*',
    '/vendor/:path*',
    '/admin/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
}
