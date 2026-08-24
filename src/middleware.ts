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
  await supabase.auth.getUser()
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
